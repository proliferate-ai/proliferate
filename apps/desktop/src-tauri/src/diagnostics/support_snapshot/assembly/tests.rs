//! Focused deterministic assembler proofs and fixture adapters.

use std::collections::BTreeMap;

use proliferate_diagnostics_protocol::v1::types::{
    CollectorAcceptedRecordV1, LifecyclePhaseV1, ProducerRecordV1, RedactionClassificationV1,
};
use serde::Deserialize;

use super::super::schema::enums::{
    SupportEndpointStateV1, SupportEvidenceSourceV1, SupportOmissionReasonV1,
    SupportSourceManifestSourceV1,
};
use super::super::schema::model::common::SupportJsonValueV1;
use super::super::schema::model::evidence::{SupportFallbackComponentV1, SupportSessionLedgerV1};
use super::super::schema::model::snapshot::SupportSnapshotV3;
use super::super::scrub::{SupportOptionalScrubbed, SupportScrubAccounting};
use super::{
    SupportAssemblyCandidateV1, SupportAssemblyInputV1, SupportAssemblyMandatoryV1,
    SupportCorrelationSelectionV1, SupportFallbackCandidateValueV1, SupportLegacyCandidateValueV1,
    SupportSessionAssemblyV1, SupportSessionCandidateV1, SupportSourceCaptureV1,
};

#[path = "tests/bounds.rs"]
mod bounds;
#[path = "tests/degradation.rs"]
mod degradation;
#[path = "tests/golden.rs"]
mod golden;
#[path = "tests/invalid.rs"]
mod invalid;
#[path = "tests/ordering.rs"]
mod ordering;
#[path = "tests/presentation.rs"]
mod presentation;

pub(super) const SCHEMA_NO_EVIDENCE: &str =
    include_str!("../schema/fixtures/golden_no_evidence_skeleton.json");
pub(super) const SCHEMA_POPULATED: &str =
    include_str!("../schema/fixtures/golden_populated_compact.json");

pub(super) fn candidate<T>(
    value: Option<T>,
    included_bytes: u64,
    original_index: u64,
) -> SupportAssemblyCandidateV1<T> {
    SupportAssemblyCandidateV1 {
        scrubbed: SupportOptionalScrubbed {
            value,
            accounting: SupportScrubAccounting::default(),
        },
        included_bytes,
        original_index,
    }
}

pub(super) fn input_from_fixture(fixture: &str) -> SupportAssemblyInputV1 {
    let snapshot: SupportSnapshotV3 = serde_json::from_str(fixture).expect("schema fixture");
    input_from_snapshot(&snapshot)
}

fn input_from_snapshot(snapshot: &SupportSnapshotV3) -> SupportAssemblyInputV1 {
    let mandatory = SupportAssemblyMandatoryV1 {
        snapshot_id: snapshot.snapshot_id.clone(),
        generated_at: snapshot.generated_at.clone(),
        app: snapshot.app.clone(),
        consent: snapshot.consent.clone(),
        selection: snapshot.selection.clone(),
        collector: snapshot.collector.clone(),
        producer_health: snapshot.producer_health.clone(),
    };
    let file_sources = snapshot
        .manifest
        .sources
        .iter()
        .filter(|source| {
            !matches!(
                source.source,
                SupportSourceManifestSourceV1::Collector
                    | SupportSourceManifestSourceV1::SessionLedger
            )
        })
        .map(|source| SupportSourceCaptureV1 {
            source: source.source,
            state: source.state,
            captured_at: source.captured_at.clone(),
            read_bytes: source.read_bytes,
        })
        .collect();
    let mut source_bytes = SourceByteAllocator::new(snapshot);
    let collector_records = snapshot
        .records
        .iter()
        .enumerate()
        .map(|(index, record)| {
            candidate(
                Some(record.clone()),
                source_bytes.take(SupportSourceManifestSourceV1::Collector),
                index as u64,
            )
        })
        .collect();
    let mut fallback = Vec::new();
    for component in &snapshot.fallback_evidence {
        match component {
            SupportFallbackComponentV1::Pr3DesktopNativeMixed {
                records,
                opaque_lines,
            } => {
                for record in records {
                    fallback.push(candidate(
                        Some(SupportFallbackCandidateValueV1::Record(record.clone())),
                        source_bytes.take(SupportSourceManifestSourceV1::DesktopNativeFallback),
                        fallback.len() as u64,
                    ));
                }
                for line in opaque_lines {
                    fallback.push(candidate(
                        Some(SupportFallbackCandidateValueV1::OpaqueLine(line.clone())),
                        source_bytes.take(SupportSourceManifestSourceV1::DesktopNativeFallback),
                        fallback.len() as u64,
                    ));
                }
            }
            SupportFallbackComponentV1::Pr5Wrapped {
                component, records, ..
            } => {
                let source = match component {
                    super::super::schema::enums::SupportChildComponentV1::Anyharness => {
                        SupportSourceManifestSourceV1::AnyharnessFallback
                    }
                    super::super::schema::enums::SupportChildComponentV1::DesktopWorker => {
                        SupportSourceManifestSourceV1::DesktopWorkerFallback
                    }
                };
                for record in records {
                    fallback.push(candidate(
                        Some(SupportFallbackCandidateValueV1::Record(record.clone())),
                        source_bytes.take(source),
                        fallback.len() as u64,
                    ));
                }
            }
        }
    }
    let mut legacy = Vec::new();
    for source in &snapshot.legacy_evidence {
        let manifest_source = super::candidate::legacy_source(source.source);
        for line in &source.lines {
            legacy.push(candidate(
                Some(SupportLegacyCandidateValueV1 {
                    source: source.source,
                    line: line.clone(),
                }),
                source_bytes.take(manifest_source),
                legacy.len() as u64,
            ));
        }
    }
    let sessions = session_input(snapshot);
    let accounting = SupportScrubAccounting {
        scrubbed_by_class: snapshot.manifest.scrubbed_by_class.clone(),
        omissions: snapshot
            .manifest
            .omissions
            .iter()
            .filter(|entry| keep_fixture_omission(entry.source, entry.reason))
            .cloned()
            .collect(),
        truncations: snapshot
            .manifest
            .truncations
            .iter()
            .filter(|entry| {
                !(entry.source == SupportEvidenceSourceV1::Package
                    && entry.reason
                        == super::super::schema::enums::SupportTruncationReasonV1::PackageBytes)
            })
            .cloned()
            .collect(),
    };
    SupportAssemblyInputV1 {
        mandatory,
        file_sources,
        collector_records,
        fallback,
        legacy,
        sessions,
        correlations: SupportCorrelationSelectionV1::default(),
        accounting,
    }
}

fn session_input(snapshot: &SupportSnapshotV3) -> SupportSessionAssemblyV1 {
    let source = snapshot
        .manifest
        .sources
        .iter()
        .find(|source| source.source == SupportSourceManifestSourceV1::SessionLedger)
        .expect("session source");
    let Some(ledger) = &snapshot.session_ledger else {
        let reason = match snapshot.manifest.session_collection {
            super::super::schema::model::manifest::SupportSessionCollectionManifestV1::Omitted {
                reason,
            } => reason,
            _ => panic!("ledger and manifest disagree"),
        };
        return SupportSessionAssemblyV1::Omitted {
            captured_at: source.captured_at.clone(),
            read_bytes: source.read_bytes,
            reason,
        };
    };
    let (summary_bytes, event_bytes, raw_bytes) = match &snapshot.manifest.session_collection {
        super::super::schema::model::manifest::SupportSessionCollectionManifestV1::Included {
            session_included_bytes,
            event_included_bytes,
            raw_notification_included_bytes,
            ..
        } => (
            *session_included_bytes,
            *event_included_bytes,
            *raw_notification_included_bytes,
        ),
        _ => panic!("ledger and manifest disagree"),
    };
    SupportSessionAssemblyV1::Included {
        captured_at: source.captured_at.clone(),
        read_bytes: source.read_bytes,
        session_list_state: ledger
            .sessions
            .first()
            .map_or(SupportEndpointStateV1::Included, |session| {
                session.endpoint_states.summary
            }),
        workspace_id: ledger.workspace_id.clone(),
        anyharness_workspace_id: ledger.anyharness_workspace_id.clone(),
        sessions: session_candidates(ledger, summary_bytes, event_bytes, raw_bytes),
    }
}

fn session_candidates(
    ledger: &SupportSessionLedgerV1,
    mut summary_bytes: u64,
    mut event_bytes: u64,
    mut raw_bytes: u64,
) -> Vec<SupportSessionCandidateV1> {
    ledger
        .sessions
        .iter()
        .enumerate()
        .map(|(selection_index, session)| {
            let summary = candidate(session.summary.clone(), take_once(&mut summary_bytes), 0);
            let normalized_events = session
                .normalized_events
                .iter()
                .enumerate()
                .map(|(index, value)| {
                    candidate(
                        Some(value.clone()),
                        take_once(&mut event_bytes),
                        index as u64,
                    )
                })
                .collect();
            let raw_notifications = session
                .raw_notifications
                .iter()
                .enumerate()
                .map(|(index, value)| {
                    candidate(Some(value.clone()), take_once(&mut raw_bytes), index as u64)
                })
                .collect();
            SupportSessionCandidateV1 {
                selection_index: selection_index as u64,
                session_id: session.session_id.clone(),
                summary_captured_at: session.summary_captured_at.clone(),
                endpoint_states: session.endpoint_states.clone(),
                summary,
                normalized_events,
                raw_notifications,
            }
        })
        .collect()
}

fn take_once(bytes: &mut u64) -> u64 {
    std::mem::take(bytes)
}

fn keep_fixture_omission(source: SupportEvidenceSourceV1, reason: SupportOmissionReasonV1) -> bool {
    if source == SupportEvidenceSourceV1::Package && reason == SupportOmissionReasonV1::PackageCap {
        return false;
    }
    if matches!(
        reason,
        SupportOmissionReasonV1::CollectorUnavailable
            | SupportOmissionReasonV1::CollectorExportInterrupted
            | SupportOmissionReasonV1::CollectorExportInvalid
            | SupportOmissionReasonV1::CollectorLimitUncertain
    ) {
        return false;
    }
    !matches!(
        (source, reason),
        (
            SupportEvidenceSourceV1::Renderer | SupportEvidenceSourceV1::Tauri,
            SupportOmissionReasonV1::ProducerStatusUnavailable
        )
    )
}

struct SourceByteAllocator {
    remaining: BTreeMap<SupportSourceManifestSourceV1, u64>,
}

impl SourceByteAllocator {
    fn new(snapshot: &SupportSnapshotV3) -> Self {
        Self {
            remaining: snapshot
                .manifest
                .sources
                .iter()
                .map(|source| (source.source, source.included_bytes))
                .collect(),
        }
    }

    fn take(&mut self, source: SupportSourceManifestSourceV1) -> u64 {
        self.remaining
            .get_mut(&source)
            .map(std::mem::take)
            .unwrap_or(0)
    }
}

pub(super) fn seq_value(sequence: i64, payload: &str) -> SupportJsonValueV1 {
    SupportJsonValueV1::Object(vec![
        (
            "payload".to_owned(),
            SupportJsonValueV1::String(payload.to_owned()),
        ),
        ("seq".to_owned(), SupportJsonValueV1::Integer(sequence)),
    ])
}

pub(super) fn with_collector_records(
    mut input: SupportAssemblyInputV1,
    records: Vec<CollectorAcceptedRecordV1>,
) -> SupportAssemblyInputV1 {
    let count = records.len() as u64;
    let first = records.first().map(|record| record.retention_cursor);
    let last = records.last().map(|record| record.retention_cursor);
    input.mandatory.collector.coverage.returned_records = count;
    input.mandatory.collector.coverage.cursor_start = first;
    input.mandatory.collector.coverage.cursor_end = last;
    input.mandatory.collector.coverage.health_oldest_cursor = first;
    input.mandatory.collector.coverage.health_newest_cursor = last;
    let manifest = input
        .mandatory
        .collector
        .export_manifest
        .as_mut()
        .expect("successful export manifest");
    manifest.record_count = count as u32;
    manifest.cursor_start = first;
    manifest.cursor_end = last;
    manifest.versions_present[0].records = count;
    let export_health = input
        .mandatory
        .collector
        .export_health
        .as_mut()
        .expect("successful export health");
    export_health.oldest_cursor = first;
    export_health.newest_cursor = last;
    let byte_count = input.mandatory.collector.coverage.returned_record_bytes;
    let first_record_bytes = byte_count.saturating_sub(count.saturating_sub(1));
    input.collector_records = records
        .into_iter()
        .enumerate()
        .map(|(index, record)| {
            candidate(
                Some(record),
                if index == 0 { first_record_bytes } else { 1 },
                index as u64,
            )
        })
        .collect();
    input
}

pub(super) fn lifecycle_records() -> (CollectorAcceptedRecordV1, CollectorAcceptedRecordV1) {
    #[derive(Deserialize)]
    struct RecordsFixture {
        records: Vec<ProducerRecordV1>,
    }
    let fixture: RecordsFixture = serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../fixtures/contracts/rust-observability-v1/valid/records.json"
    )))
    .expect("protocol lifecycle fixture");
    let mut lifecycle: Vec<_> = fixture
        .records
        .into_iter()
        .filter(|record| record.lifecycle.is_some())
        .take(2)
        .collect();
    let mut started = lifecycle.remove(0);
    let mut terminal = lifecycle.remove(0);
    assert_eq!(
        started.lifecycle.as_ref().map(|value| value.phase),
        Some(LifecyclePhaseV1::Started)
    );
    assert_eq!(
        terminal.lifecycle.as_ref().map(|value| value.phase),
        Some(LifecyclePhaseV1::Terminal)
    );
    for record in [&mut started, &mut terminal] {
        record.source_timestamp = "2026-08-11T23:50:00+00:00".to_owned();
        record.redaction = RedactionClassificationV1::SupportExport;
    }
    (
        CollectorAcceptedRecordV1 {
            record: started,
            accepted_timestamp: "2026-08-11T23:50:01+00:00".to_owned(),
            accepted_order: 39,
            retention_cursor: 39,
        },
        CollectorAcceptedRecordV1 {
            record: terminal,
            accepted_timestamp: "2026-08-11T23:50:02+00:00".to_owned(),
            accepted_order: 40,
            retention_cursor: 40,
        },
    )
}
