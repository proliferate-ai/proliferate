use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::time::Instant;

use proliferate_diagnostics_client::FallbackReason;
use proliferate_diagnostics_protocol::v1::types::ComponentV1;

use crate::diagnostics_collector::child_bridge::support_evidence::{
    EvidenceSource, EvidenceSourceRead, EvidenceSourceState, EvidenceValue, FiniteEvidenceCapture,
};

use super::super::artifact_store::{
    ArtifactStoreError, StoredSupportArtifact, SupportArtifactReference, SupportArtifactStore,
};
use super::super::assembly::{
    assemble_support_snapshot, SupportAssemblyCandidateV1, SupportAssemblyInputV1,
    SupportAssemblyMandatoryV1, SupportCorrelationSelectionV1, SupportFallbackCandidateValueV1,
    SupportLegacyCandidateValueV1, SupportSourceCaptureV1,
};
use super::super::schema::enums::{
    SupportConsentDisclosureVersionV1, SupportEvidenceSourceV1, SupportFallbackDispositionV1,
    SupportFallbackRecordComponentV1, SupportLegacySourceKindV1, SupportPr5FallbackReasonV1,
    SupportSessionSelectionV1, SupportSourceManifestSourceV1, SupportSourceStateV1,
    SupportUnknownDesktopNativeV1,
};
use super::super::schema::model::common::SupportJsonValueV1;
use super::super::schema::model::evidence::{
    SupportFallbackRecordV1, SupportLegacyLineV1, SupportOpaqueFallbackLineV1,
};
use super::super::schema::model::snapshot::{SupportAppV1, SupportConsentV1, SupportSelectionV1};
use super::super::schema::validate::validate_snapshot;
use super::super::scrub::{SupportExportScrubber, SupportOptionalScrubbed, SupportScrubAccounting};
use super::byte_allocation::allocate_exact_response_bytes;
use super::capture::CapturedNativeSupportEvidence;
use super::file_accounting::record_file_residuals;
use super::model::{
    reference_from_stored, BeginSupportSnapshotInput, PreparedSupportSnapshotOutput,
    PreparedSupportSnapshotSummaryOutput,
};
use super::runtime::CoordinatorRuntime;
use super::session_input::{parse_session_input, SessionInputError};

pub(super) struct FinishWork {
    pub begin: BeginSupportSnapshotInput,
    pub preparation_id: String,
    pub snapshot_id: String,
    pub preparation_operation_id: String,
    pub captured_at: String,
    pub source_time_from: String,
    pub source_time_to: String,
    pub captured: CapturedNativeSupportEvidence,
    pub session_evidence_json: Option<String>,
    pub session_collection:
        super::super::schema::model::manifest::SupportSessionCollectionManifestV1,
}

pub(super) struct FinishResult {
    pub output: PreparedSupportSnapshotOutput,
    pub reference: SupportArtifactReference,
}

pub(super) fn finish_and_stage(
    store: Arc<SupportArtifactStore>,
    work: FinishWork,
    cancelled: &AtomicBool,
    deadline: Instant,
    runtime: &dyn CoordinatorRuntime,
) -> Result<FinishResult, FinishError> {
    check_finish(cancelled, deadline, runtime)?;
    let home = crate::app_config::home_dir().map_err(|_| FinishError::Scrub)?;
    let home = home.to_str().ok_or(FinishError::Scrub)?.to_owned();
    let scrubber = SupportExportScrubber::new(Some(home)).map_err(|_| FinishError::Scrub)?;
    check_finish(cancelled, deadline, runtime)?;
    let (sessions, mut accounting) = parse_session_input(
        work.session_evidence_json.as_deref(),
        &work.session_collection,
        &work.begin,
        &work.source_time_from,
        &work.source_time_to,
        &scrubber,
    )
    .map_err(map_session_error)?;
    check_finish(cancelled, deadline, runtime)?;
    let mandatory = SupportAssemblyMandatoryV1 {
        snapshot_id: work.snapshot_id.clone(),
        generated_at: work.captured_at.clone(),
        app: app_identity(),
        consent: SupportConsentV1 {
            disclosure_version:
                SupportConsentDisclosureVersionV1::DesktopSupportSnapshotCustomerContentV1,
            granted_at: work.begin.consent.granted_at.clone(),
            selection: selection_kind(&work.begin),
        },
        selection: selection(&work),
        collector: work.captured.collector.clone(),
        producer_health: work.captured.producer_health.clone(),
    };
    let collector_bytes = mandatory.collector.coverage.returned_record_bytes;
    let mut collector_records = Vec::with_capacity(work.captured.collector_records.len());
    for (index, record) in work.captured.collector_records.into_iter().enumerate() {
        let scrubbed = scrubber
            .scrub_accepted_record(record, SupportEvidenceSourceV1::Collector)
            .map_err(|_| FinishError::Scrub)?;
        collector_records.push(SupportAssemblyCandidateV1 {
            scrubbed,
            included_bytes: 0,
            original_index: index as u64,
        });
    }
    allocate_exact_response_bytes(&mut collector_records, collector_bytes)
        .map_err(|_| FinishError::Manifest)?;
    let (file_sources, fallback, legacy) = convert_file_evidence(
        work.captured.files,
        &work.captured_at,
        &scrubber,
        &mut accounting,
    )?;
    check_finish(cancelled, deadline, runtime)?;
    let assembled = assemble_support_snapshot(SupportAssemblyInputV1 {
        mandatory,
        file_sources,
        collector_records,
        fallback,
        legacy,
        sessions,
        correlations: SupportCorrelationSelectionV1::default(),
        accounting,
    })
    .map_err(|_| FinishError::Manifest)?;
    validate_snapshot(&assembled.snapshot).map_err(|_| FinishError::Manifest)?;
    check_finish(cancelled, deadline, runtime)?;
    let stored = store
        .stage(
            &work.begin.client_job_id,
            &work.snapshot_id,
            &work.preparation_id,
            &assembled.compact_json,
        )
        .map_err(map_store_error)?;
    if let Err(error) = check_finish(cancelled, deadline, runtime) {
        let _ = store.delete(&stored.artifact_id);
        return Err(error);
    }
    let output = output_from(&assembled.snapshot, &stored, &work.preparation_operation_id);
    Ok(FinishResult {
        output,
        reference: reference_from_stored(&stored),
    })
}

fn convert_file_evidence(
    files: FiniteEvidenceCapture,
    captured_at: &str,
    scrubber: &SupportExportScrubber,
    accounting: &mut SupportScrubAccounting,
) -> Result<
    (
        Vec<SupportSourceCaptureV1>,
        Vec<SupportAssemblyCandidateV1<SupportFallbackCandidateValueV1>>,
        Vec<SupportAssemblyCandidateV1<SupportLegacyCandidateValueV1>>,
    ),
    FinishError,
> {
    let measured_total = files.sources.iter().try_fold(0_u64, |total, source| {
        total
            .checked_add(source.read_bytes)
            .ok_or(FinishError::Manifest)
    })?;
    if measured_total != files.total_read_bytes {
        return Err(FinishError::Manifest);
    }
    let mut sources = Vec::with_capacity(files.sources.len());
    let mut fallback = Vec::new();
    let mut legacy = Vec::new();
    let mut original_index = 0_u64;
    for source in files.sources {
        record_file_residuals(&source, accounting)?;
        sources.push(SupportSourceCaptureV1 {
            source: manifest_source(source.source),
            state: source_state(source.state),
            captured_at: captured_at.to_owned(),
            read_bytes: source.read_bytes,
        });
        convert_source(
            source,
            scrubber,
            &mut original_index,
            &mut fallback,
            &mut legacy,
        )?;
    }
    Ok((sources, fallback, legacy))
}

fn convert_source(
    source: EvidenceSourceRead,
    scrubber: &SupportExportScrubber,
    original_index: &mut u64,
    fallback: &mut Vec<SupportAssemblyCandidateV1<SupportFallbackCandidateValueV1>>,
    legacy: &mut Vec<SupportAssemblyCandidateV1<SupportLegacyCandidateValueV1>>,
) -> Result<(), FinishError> {
    for line in source.lines {
        let index = *original_index;
        *original_index = original_index.saturating_add(1);
        match line.value {
            EvidenceValue::DesktopRecord(record) => {
                let record_source = match record.component {
                    ComponentV1::DesktopRenderer => SupportEvidenceSourceV1::Renderer,
                    ComponentV1::DesktopTauri => SupportEvidenceSourceV1::Tauri,
                    _ => return Err(FinishError::Manifest),
                };
                let scrubbed = scrubber
                    .scrub_producer_record(record, record_source)
                    .map_err(|_| FinishError::Scrub)?;
                fallback.push(SupportAssemblyCandidateV1 {
                    scrubbed: map_scrubbed(scrubbed, |record| {
                        Some(SupportFallbackCandidateValueV1::Record(
                            SupportFallbackRecordV1 {
                                component: fallback_component(record.component)?,
                                disposition: SupportFallbackDispositionV1::NotCollectorAccepted,
                                fallback_reason: None,
                                record,
                                segment: line.segment,
                                line: line.line,
                            },
                        ))
                    }),
                    included_bytes: line.included_bytes,
                    original_index: index,
                });
            }
            EvidenceValue::DesktopOpaque { value, .. } => {
                let scrubbed = scrub_string(value, scrubber, evidence_source(source.source))?;
                fallback.push(SupportAssemblyCandidateV1 {
                    scrubbed: map_scrubbed(scrubbed, |value| {
                        Some(SupportFallbackCandidateValueV1::OpaqueLine(
                            SupportOpaqueFallbackLineV1 {
                                component: SupportUnknownDesktopNativeV1::UnknownDesktopNative,
                                value,
                                segment: line.segment,
                                line: line.line,
                                semantic_claims: false,
                            },
                        ))
                    }),
                    included_bytes: line.included_bytes,
                    original_index: index,
                });
            }
            EvidenceValue::Wrapped(wrapper) => {
                let reason = map_fallback_reason(wrapper.reason);
                let disposition = if wrapper.reason == FallbackReason::DeliveryUnknown {
                    SupportFallbackDispositionV1::DeliveryUnknown
                } else {
                    SupportFallbackDispositionV1::NotCollectorAccepted
                };
                let scrubbed = scrubber
                    .scrub_producer_record(wrapper.record, evidence_source(source.source))
                    .map_err(|_| FinishError::Scrub)?;
                fallback.push(SupportAssemblyCandidateV1 {
                    scrubbed: map_scrubbed(scrubbed, |record| {
                        Some(SupportFallbackCandidateValueV1::Record(
                            SupportFallbackRecordV1 {
                                component: fallback_component(record.component)?,
                                disposition,
                                fallback_reason: Some(reason),
                                record,
                                segment: line.segment,
                                line: line.line,
                            },
                        ))
                    }),
                    included_bytes: line.included_bytes,
                    original_index: index,
                });
            }
            EvidenceValue::Legacy { value, .. } => {
                let scrubbed = scrub_string(value, scrubber, evidence_source(source.source))?;
                let legacy_source = legacy_source(source.source).ok_or(FinishError::Manifest)?;
                legacy.push(SupportAssemblyCandidateV1 {
                    scrubbed: map_scrubbed(scrubbed, |value| match value {
                        SupportJsonValueV1::String(value) => Some(SupportLegacyCandidateValueV1 {
                            source: legacy_source,
                            line: SupportLegacyLineV1 {
                                segment: line.segment,
                                line: line.line,
                                value,
                            },
                        }),
                        _ => None,
                    }),
                    included_bytes: line.included_bytes,
                    original_index: index,
                });
            }
        }
    }
    Ok(())
}

fn scrub_string(
    value: String,
    scrubber: &SupportExportScrubber,
    source: SupportEvidenceSourceV1,
) -> Result<SupportOptionalScrubbed<SupportJsonValueV1>, FinishError> {
    scrubber
        .scrub_optional_value(SupportJsonValueV1::String(value), source)
        .map_err(|_| FinishError::Scrub)
}

fn map_scrubbed<T, U>(
    scrubbed: SupportOptionalScrubbed<T>,
    mapper: impl FnOnce(T) -> Option<U>,
) -> SupportOptionalScrubbed<U> {
    SupportOptionalScrubbed {
        value: scrubbed.value.and_then(mapper),
        accounting: scrubbed.accounting,
    }
}

fn manifest_source(source: EvidenceSource) -> SupportSourceManifestSourceV1 {
    match source {
        EvidenceSource::DesktopNativeFallback => {
            SupportSourceManifestSourceV1::DesktopNativeFallback
        }
        EvidenceSource::AnyharnessFallback => SupportSourceManifestSourceV1::AnyharnessFallback,
        EvidenceSource::DesktopWorkerFallback => {
            SupportSourceManifestSourceV1::DesktopWorkerFallback
        }
        EvidenceSource::RendererLegacy => SupportSourceManifestSourceV1::RendererLegacy,
        EvidenceSource::AnyharnessLegacy => SupportSourceManifestSourceV1::AnyharnessLegacy,
        EvidenceSource::WorkerLegacyV2 => SupportSourceManifestSourceV1::WorkerLegacyV2,
        EvidenceSource::WorkerLegacyV1 => SupportSourceManifestSourceV1::WorkerLegacyV1,
    }
}

fn evidence_source(source: EvidenceSource) -> SupportEvidenceSourceV1 {
    match source {
        EvidenceSource::DesktopNativeFallback => SupportEvidenceSourceV1::Tauri,
        EvidenceSource::RendererLegacy => SupportEvidenceSourceV1::Renderer,
        EvidenceSource::AnyharnessFallback | EvidenceSource::AnyharnessLegacy => {
            SupportEvidenceSourceV1::Anyharness
        }
        EvidenceSource::DesktopWorkerFallback
        | EvidenceSource::WorkerLegacyV2
        | EvidenceSource::WorkerLegacyV1 => SupportEvidenceSourceV1::DesktopWorker,
    }
}

fn source_state(state: EvidenceSourceState) -> SupportSourceStateV1 {
    match state {
        EvidenceSourceState::Included => SupportSourceStateV1::Included,
        EvidenceSourceState::Missing => SupportSourceStateV1::Missing,
        EvidenceSourceState::Unreadable => SupportSourceStateV1::Unreadable,
        EvidenceSourceState::UnsafeMetadata => SupportSourceStateV1::Unsafe,
        EvidenceSourceState::Invalid => SupportSourceStateV1::Invalid,
        EvidenceSourceState::Omitted => SupportSourceStateV1::Omitted,
    }
}

fn legacy_source(source: EvidenceSource) -> Option<SupportLegacySourceKindV1> {
    Some(match source {
        EvidenceSource::RendererLegacy => SupportLegacySourceKindV1::RendererDiagnostics,
        EvidenceSource::AnyharnessLegacy => SupportLegacySourceKindV1::AnyharnessPrimary,
        EvidenceSource::WorkerLegacyV2 => SupportLegacySourceKindV1::WorkerPrimaryV2,
        EvidenceSource::WorkerLegacyV1 => SupportLegacySourceKindV1::WorkerPrimaryV1,
        _ => return None,
    })
}

fn fallback_component(component: ComponentV1) -> Option<SupportFallbackRecordComponentV1> {
    Some(match component {
        ComponentV1::DesktopRenderer => SupportFallbackRecordComponentV1::DesktopRenderer,
        ComponentV1::DesktopTauri => SupportFallbackRecordComponentV1::DesktopTauri,
        ComponentV1::Anyharness => SupportFallbackRecordComponentV1::Anyharness,
        ComponentV1::DesktopWorker => SupportFallbackRecordComponentV1::DesktopWorker,
        _ => return None,
    })
}

fn map_fallback_reason(reason: FallbackReason) -> SupportPr5FallbackReasonV1 {
    match reason {
        FallbackReason::CollectorUnavailable => SupportPr5FallbackReasonV1::CollectorUnavailable,
        FallbackReason::GenerationChanged => SupportPr5FallbackReasonV1::GenerationChanged,
        FallbackReason::TransportCooldown => SupportPr5FallbackReasonV1::TransportCooldown,
        FallbackReason::DeliveryUnknown => SupportPr5FallbackReasonV1::DeliveryUnknown,
        FallbackReason::FinalTeardown => SupportPr5FallbackReasonV1::FinalTeardown,
    }
}

fn app_identity() -> SupportAppV1 {
    SupportAppV1 {
        version: env!("CARGO_PKG_VERSION").to_owned(),
        release: format!("proliferate-desktop-native@{}", env!("CARGO_PKG_VERSION")),
        platform: format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH),
        runtime_version: None,
        runtime_status: None,
    }
}

fn selection_kind(begin: &BeginSupportSnapshotInput) -> SupportSessionSelectionV1 {
    match &begin.consent.selection {
        super::model::SupportSnapshotSelectionInput::ActiveSession { .. } => {
            SupportSessionSelectionV1::ActiveSession
        }
        super::model::SupportSnapshotSelectionInput::RecentActivity { .. } => {
            SupportSessionSelectionV1::RecentActivity
        }
    }
}

pub(super) fn check_finish(
    cancelled: &AtomicBool,
    deadline: Instant,
    runtime: &dyn CoordinatorRuntime,
) -> Result<(), FinishError> {
    if cancelled.load(Ordering::Acquire) {
        Err(FinishError::Cancelled)
    } else if runtime.instant_now() >= deadline {
        Err(FinishError::Deadline)
    } else {
        Ok(())
    }
}

fn selection(work: &FinishWork) -> SupportSelectionV1 {
    use super::model::{SupportSnapshotSelectionInput as Selection, SupportSnapshotWorkspaceInput};
    let (workspace_id, anyharness_workspace_id, ui_session_id, materialized_session_id) =
        match &work.begin.consent.selection {
            Selection::ActiveSession {
                workspace,
                ui_session_id,
                materialized_session_id,
            } => (
                Some(workspace.workspace_id.clone()),
                Some(workspace.anyharness_workspace_id.clone()),
                Some(ui_session_id.clone()),
                Some(materialized_session_id.clone()),
            ),
            Selection::RecentActivity {
                workspace:
                    SupportSnapshotWorkspaceInput::BundledLocal {
                        workspace_id,
                        anyharness_workspace_id,
                    },
            } => (
                Some(workspace_id.clone()),
                Some(anyharness_workspace_id.clone()),
                None,
                None,
            ),
            Selection::RecentActivity {
                workspace: SupportSnapshotWorkspaceInput::None { .. },
            } => (None, None, None, None),
        };
    SupportSelectionV1 {
        report_opened_at: work.begin.report_opened_at.clone(),
        source_time_from: work.source_time_from.clone(),
        source_time_to: work.source_time_to.clone(),
        workspace_id,
        anyharness_workspace_id,
        ui_session_id,
        materialized_session_id,
    }
}

fn output_from(
    snapshot: &super::super::schema::model::snapshot::SupportSnapshotV3,
    stored: &StoredSupportArtifact,
    preparation_operation_id: &str,
) -> PreparedSupportSnapshotOutput {
    let fallback_records = snapshot
        .fallback_evidence
        .iter()
        .map(|value| match value {
            super::super::schema::model::evidence::SupportFallbackComponentV1::Pr3DesktopNativeMixed { records, opaque_lines } => records.len() + opaque_lines.len(),
            super::super::schema::model::evidence::SupportFallbackComponentV1::Pr5Wrapped { records, .. } => records.len(),
        })
        .sum::<usize>() as u64;
    PreparedSupportSnapshotOutput {
        artifact_schema_version: 3,
        artifact_id: stored.artifact_id.clone(),
        snapshot_id: stored.snapshot_id.clone(),
        preparation_operation_id: preparation_operation_id.to_owned(),
        generated_at: snapshot.generated_at.clone(),
        size_bytes: stored.size_bytes,
        sha256: stored.sha256.clone(),
        summary: PreparedSupportSnapshotSummaryOutput {
            collector_records: snapshot.records.len() as u64,
            fallback_records,
            sessions: snapshot
                .session_ledger
                .as_ref()
                .map_or(0, |ledger| ledger.sessions.len() as u64),
            omissions: snapshot.manifest.omissions.len() as u64
                + snapshot.manifest.additional_entries.omissions,
            truncations: snapshot.manifest.truncations.len() as u64
                + snapshot.manifest.additional_entries.truncations,
        },
    }
}

fn map_session_error(error: SessionInputError) -> FinishError {
    match error {
        SessionInputError::Scrub => FinishError::Scrub,
        SessionInputError::TooLarge
        | SessionInputError::Invalid
        | SessionInputError::Incoherent => FinishError::Manifest,
    }
}

fn map_store_error(error: ArtifactStoreError) -> FinishError {
    match error {
        ArtifactStoreError::StageFailed => FinishError::Stage,
        ArtifactStoreError::ArtifactVerificationFailed => FinishError::Verification,
        _ => FinishError::Stage,
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum FinishError {
    Cancelled,
    Deadline,
    Scrub,
    Manifest,
    Stage,
    Verification,
}
