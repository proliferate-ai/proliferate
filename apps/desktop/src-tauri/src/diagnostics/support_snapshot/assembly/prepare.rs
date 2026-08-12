//! Mandatory omission, bounded source, and session-shell preparation.

use std::collections::BTreeMap;

use super::super::schema::enums::{
    SupportChildOmissionReasonV1, SupportCollectorStatusV1, SupportEndpointStateV1,
    SupportEvidenceSourceV1, SupportOmissionReasonV1, SupportSessionOmissionReasonV1,
    SupportSessionSelectionV1, SupportSourceManifestSourceV1, SupportSourceStateV1,
    SupportTruncationReasonV1,
};
use super::super::schema::limits::{
    ALL_FILES_READ_BYTES, ANYHARNESS_FALLBACK_BYTES, COMPONENT_FILES_READ_BYTES,
    DESKTOP_NATIVE_FALLBACK_BYTES, DESKTOP_WORKER_FALLBACK_BYTES, SESSIONS, SESSION_EVIDENCE_BYTES,
};
use super::super::schema::model::health::SupportChildProducerStatusV1;
use super::super::schema::validate::{validate_id, validate_safe_u64, validate_timestamp};
use super::accounting::AssemblyAccounting;
use super::candidate::{evidence_source_for_manifest, session_atom};
use super::input::{
    SupportAssemblyError, SupportAssemblyMandatoryV1, SupportSessionAssemblyV1,
    SupportSessionCandidateV1, SupportSourceCaptureV1,
};
use super::presentation::{SessionPlan, SessionShell};
use super::ranking::CandidateAtom;

pub(super) fn prepare_sessions(
    sessions: SupportSessionAssemblyV1,
    mandatory: &SupportAssemblyMandatoryV1,
    accounting: &mut AssemblyAccounting,
) -> Result<(SessionPlan, SupportSourceCaptureV1, Vec<CandidateAtom>), SupportAssemblyError> {
    match sessions {
        SupportSessionAssemblyV1::Omitted {
            captured_at,
            read_bytes,
            reason,
        } => omitted_session(
            captured_at,
            read_bytes,
            if mandatory.selection.workspace_id.is_none() {
                SupportSessionOmissionReasonV1::NoSelectedBundledLocalWorkspace
            } else {
                reason
            },
            mandatory,
            accounting,
        ),
        SupportSessionAssemblyV1::Included {
            captured_at,
            read_bytes,
            workspace_id,
            anyharness_workspace_id,
            mut sessions,
        } => {
            sessions.sort_by_key(|session| session.selection_index);
            if !valid_session_source(
                mandatory,
                &workspace_id,
                &anyharness_workspace_id,
                read_bytes,
                &sessions,
            ) || validate_timestamp(&captured_at).is_err()
            {
                absorb_session_accounting(&sessions, accounting)?;
                return omitted_session(
                    captured_at,
                    read_bytes,
                    if mandatory.selection.workspace_id.is_none() {
                        SupportSessionOmissionReasonV1::NoSelectedBundledLocalWorkspace
                    } else {
                        SupportSessionOmissionReasonV1::SessionInvalid
                    },
                    mandatory,
                    accounting,
                );
            }
            included_session(
                captured_at,
                read_bytes,
                workspace_id,
                anyharness_workspace_id,
                sessions,
                mandatory,
                accounting,
            )
        }
    }
}

fn included_session(
    captured_at: String,
    read_bytes: u64,
    workspace_id: String,
    anyharness_workspace_id: String,
    sessions: Vec<SupportSessionCandidateV1>,
    mandatory: &SupportAssemblyMandatoryV1,
    accounting: &mut AssemblyAccounting,
) -> Result<(SessionPlan, SupportSourceCaptureV1, Vec<CandidateAtom>), SupportAssemblyError> {
    let tier = match mandatory.consent.selection {
        SupportSessionSelectionV1::ActiveSession => 1,
        SupportSessionSelectionV1::RecentActivity => 6,
    };
    let mut shells = Vec::with_capacity(sessions.len());
    let mut atoms = Vec::new();
    for session in sessions {
        let selection_index = session.selection_index;
        let summary_captured_at = session.summary_captured_at.clone();
        shells.push(SessionShell {
            selection_index,
            session_id: session.session_id,
            summary_captured_at: summary_captured_at.clone(),
            endpoint_states: session.endpoint_states,
        });
        if let Some(atom) = session_atom(
            session.summary,
            selection_index,
            &summary_captured_at,
            0,
            tier,
            accounting,
        )? {
            atoms.push(atom);
        }
        for candidate in session.normalized_events {
            if let Some(atom) = session_atom(
                candidate,
                selection_index,
                &summary_captured_at,
                1,
                tier,
                accounting,
            )? {
                atoms.push(atom);
            }
        }
        for candidate in session.raw_notifications {
            if let Some(atom) = session_atom(
                candidate,
                selection_index,
                &summary_captured_at,
                2,
                7,
                accounting,
            )? {
                atoms.push(atom);
            }
        }
    }
    Ok((
        SessionPlan::Included {
            workspace_id,
            anyharness_workspace_id,
            shells,
        },
        SupportSourceCaptureV1 {
            source: SupportSourceManifestSourceV1::SessionLedger,
            state: SupportSourceStateV1::Included,
            captured_at,
            read_bytes,
        },
        atoms,
    ))
}

fn omitted_session(
    captured_at: String,
    read_bytes: u64,
    reason: SupportSessionOmissionReasonV1,
    mandatory: &SupportAssemblyMandatoryV1,
    accounting: &mut AssemblyAccounting,
) -> Result<(SessionPlan, SupportSourceCaptureV1, Vec<CandidateAtom>), SupportAssemblyError> {
    ensure_session_omission(accounting, reason)?;
    Ok((
        SessionPlan::Omitted { reason },
        SupportSourceCaptureV1 {
            source: SupportSourceManifestSourceV1::SessionLedger,
            state: SupportSourceStateV1::Omitted,
            captured_at: valid_capture_time(captured_at, &mandatory.generated_at),
            read_bytes: read_bytes.min(SESSION_EVIDENCE_BYTES),
        },
        Vec::new(),
    ))
}

fn valid_session_source(
    mandatory: &SupportAssemblyMandatoryV1,
    workspace_id: &str,
    anyharness_workspace_id: &str,
    read_bytes: u64,
    sessions: &[SupportSessionCandidateV1],
) -> bool {
    if validate_id(workspace_id).is_err()
        || validate_id(anyharness_workspace_id).is_err()
        || validate_safe_u64(read_bytes).is_err()
        || read_bytes > SESSION_EVIDENCE_BYTES
        || mandatory.selection.workspace_id.as_deref() != Some(workspace_id)
        || mandatory.selection.anyharness_workspace_id.as_deref() != Some(anyharness_workspace_id)
        || sessions.len() > SESSIONS as usize
    {
        return false;
    }
    let count_valid = match mandatory.consent.selection {
        SupportSessionSelectionV1::ActiveSession => {
            sessions.len() == 1
                && mandatory.selection.materialized_session_id.as_deref()
                    == sessions.first().map(|session| session.session_id.as_str())
        }
        SupportSessionSelectionV1::RecentActivity => true,
    };
    count_valid
        && sessions.iter().enumerate().all(|(index, session)| {
            session.selection_index == index as u64
                && validate_id(&session.session_id).is_ok()
                && validate_timestamp(&session.summary_captured_at).is_ok()
                && valid_endpoint_values(session)
        })
}

fn valid_endpoint_values(session: &SupportSessionCandidateV1) -> bool {
    use SupportEndpointStateV1::{Included, LimitUncertain, Omitted};
    let summary = session.summary.scrubbed.value.is_some();
    let events = session
        .normalized_events
        .iter()
        .any(|candidate| candidate.scrubbed.value.is_some());
    let raw = session
        .raw_notifications
        .iter()
        .any(|candidate| candidate.scrubbed.value.is_some());
    matches!(
        (session.endpoint_states.summary, summary),
        (Included, true) | (LimitUncertain, _) | (Omitted, false)
    ) && matches!(
        (session.endpoint_states.events, events),
        (Included, _) | (LimitUncertain, _) | (Omitted, false)
    ) && matches!(
        (session.endpoint_states.raw_notifications, raw),
        (Included, _) | (LimitUncertain, _) | (Omitted, false)
    )
}

fn absorb_session_accounting(
    sessions: &[SupportSessionCandidateV1],
    accounting: &mut AssemblyAccounting,
) -> Result<(), SupportAssemblyError> {
    for session in sessions {
        accounting.absorb_scrub(&session.summary.scrubbed.accounting)?;
        for candidate in session
            .normalized_events
            .iter()
            .chain(&session.raw_notifications)
        {
            accounting.absorb_scrub(&candidate.scrubbed.accounting)?;
        }
    }
    Ok(())
}

pub(super) fn normalize_file_sources(
    sources: Vec<SupportSourceCaptureV1>,
    generated_at: &str,
    accounting: &mut AssemblyAccounting,
) -> Result<Vec<SupportSourceCaptureV1>, SupportAssemblyError> {
    let mut by_source = BTreeMap::new();
    for source in sources {
        if matches!(
            source.source,
            SupportSourceManifestSourceV1::Collector | SupportSourceManifestSourceV1::SessionLedger
        ) || by_source.insert(source.source, source).is_some()
        {
            return Err(SupportAssemblyError::InvalidSourceAccounting);
        }
    }
    let mut family_used = [0_u64; 3];
    let mut global_used = 0_u64;
    let mut normalized = Vec::new();
    for source in file_source_order() {
        let Some(mut capture) = by_source.remove(&source) else {
            continue;
        };
        if validate_timestamp(&capture.captured_at).is_err() {
            capture.captured_at = generated_at.to_owned();
            capture.state = SupportSourceStateV1::Invalid;
        }
        let family = source_family(source);
        let allowed = source_read_cap(source)
            .min(COMPONENT_FILES_READ_BYTES.saturating_sub(family_used[family]))
            .min(ALL_FILES_READ_BYTES.saturating_sub(global_used));
        if capture.read_bytes > allowed {
            let omitted = capture.read_bytes - allowed;
            accounting.note_source_cap(
                evidence_source_for_manifest(source),
                1,
                omitted,
                SupportTruncationReasonV1::ComponentBytes,
            )?;
            capture.read_bytes = allowed;
        }
        validate_safe_u64(capture.read_bytes)
            .map_err(|_| SupportAssemblyError::InvalidSourceAccounting)?;
        family_used[family] += capture.read_bytes;
        global_used += capture.read_bytes;
        add_source_state_omission(&capture, accounting)?;
        normalized.push(capture);
    }
    Ok(normalized)
}

pub(super) fn add_mandatory_omissions(
    mandatory: &SupportAssemblyMandatoryV1,
    accounting: &mut AssemblyAccounting,
) -> Result<(), SupportAssemblyError> {
    if let Some(reason) = collector_omission(mandatory.collector.coverage.status) {
        accounting.ensure_omission(SupportEvidenceSourceV1::Collector, reason)?;
    }
    accounting.ensure_omission(
        SupportEvidenceSourceV1::Renderer,
        SupportOmissionReasonV1::ProducerStatusUnavailable,
    )?;
    accounting.ensure_omission(
        SupportEvidenceSourceV1::Tauri,
        SupportOmissionReasonV1::ProducerStatusUnavailable,
    )?;
    for (source, status) in [
        (
            SupportEvidenceSourceV1::Anyharness,
            &mandatory.producer_health.anyharness,
        ),
        (
            SupportEvidenceSourceV1::DesktopWorker,
            &mandatory.producer_health.desktop_worker,
        ),
    ] {
        if let SupportChildProducerStatusV1::Omitted { reason, .. } = status {
            accounting.ensure_omission(source, child_omission(*reason))?;
        }
    }
    Ok(())
}

fn add_source_state_omission(
    capture: &SupportSourceCaptureV1,
    accounting: &mut AssemblyAccounting,
) -> Result<(), SupportAssemblyError> {
    let reason = match capture.state {
        SupportSourceStateV1::Included => return Ok(()),
        SupportSourceStateV1::Missing | SupportSourceStateV1::Omitted => {
            SupportOmissionReasonV1::SourceMissing
        }
        SupportSourceStateV1::Unreadable => SupportOmissionReasonV1::SourceUnreadable,
        SupportSourceStateV1::Unsafe => SupportOmissionReasonV1::SourceUnsafeMetadata,
        SupportSourceStateV1::Invalid => SupportOmissionReasonV1::SourceInvalid,
    };
    accounting.ensure_omission(evidence_source_for_manifest(capture.source), reason)
}

fn ensure_session_omission(
    accounting: &mut AssemblyAccounting,
    reason: SupportSessionOmissionReasonV1,
) -> Result<(), SupportAssemblyError> {
    accounting.ensure_omission(
        SupportEvidenceSourceV1::SessionLedger,
        match reason {
            SupportSessionOmissionReasonV1::NoSelectedBundledLocalWorkspace => {
                SupportOmissionReasonV1::NoSelectedBundledLocalWorkspace
            }
            SupportSessionOmissionReasonV1::SessionUnavailable => {
                SupportOmissionReasonV1::SessionUnavailable
            }
            SupportSessionOmissionReasonV1::SessionTimeout => {
                SupportOmissionReasonV1::SessionTimeout
            }
            SupportSessionOmissionReasonV1::SessionInvalid => {
                SupportOmissionReasonV1::SessionInvalid
            }
        },
    )
}

pub(super) fn collector_source_state(status: SupportCollectorStatusV1) -> SupportSourceStateV1 {
    match status {
        SupportCollectorStatusV1::Complete | SupportCollectorStatusV1::LimitUncertain => {
            SupportSourceStateV1::Included
        }
        SupportCollectorStatusV1::Unavailable => SupportSourceStateV1::Omitted,
        SupportCollectorStatusV1::Interrupted | SupportCollectorStatusV1::Invalid => {
            SupportSourceStateV1::Invalid
        }
    }
}

fn collector_omission(status: SupportCollectorStatusV1) -> Option<SupportOmissionReasonV1> {
    match status {
        SupportCollectorStatusV1::Complete => None,
        SupportCollectorStatusV1::LimitUncertain => {
            Some(SupportOmissionReasonV1::CollectorLimitUncertain)
        }
        SupportCollectorStatusV1::Unavailable => {
            Some(SupportOmissionReasonV1::CollectorUnavailable)
        }
        SupportCollectorStatusV1::Interrupted => {
            Some(SupportOmissionReasonV1::CollectorExportInterrupted)
        }
        SupportCollectorStatusV1::Invalid => Some(SupportOmissionReasonV1::CollectorExportInvalid),
    }
}

fn child_omission(reason: SupportChildOmissionReasonV1) -> SupportOmissionReasonV1 {
    match reason {
        SupportChildOmissionReasonV1::ProducerStatusUnavailable => {
            SupportOmissionReasonV1::ProducerStatusUnavailable
        }
        SupportChildOmissionReasonV1::ChildMissing => SupportOmissionReasonV1::ChildMissing,
        SupportChildOmissionReasonV1::SourceInvalid => SupportOmissionReasonV1::SourceInvalid,
    }
}

fn valid_capture_time(value: String, fallback: &str) -> String {
    if validate_timestamp(&value).is_ok() {
        value
    } else {
        fallback.to_owned()
    }
}

fn source_read_cap(source: SupportSourceManifestSourceV1) -> u64 {
    match source {
        SupportSourceManifestSourceV1::DesktopNativeFallback => DESKTOP_NATIVE_FALLBACK_BYTES,
        SupportSourceManifestSourceV1::AnyharnessFallback => ANYHARNESS_FALLBACK_BYTES,
        SupportSourceManifestSourceV1::DesktopWorkerFallback => DESKTOP_WORKER_FALLBACK_BYTES,
        SupportSourceManifestSourceV1::RendererLegacy
        | SupportSourceManifestSourceV1::AnyharnessLegacy
        | SupportSourceManifestSourceV1::WorkerLegacyV2
        | SupportSourceManifestSourceV1::WorkerLegacyV1 => COMPONENT_FILES_READ_BYTES,
        SupportSourceManifestSourceV1::Collector | SupportSourceManifestSourceV1::SessionLedger => {
            0
        }
    }
}

fn source_family(source: SupportSourceManifestSourceV1) -> usize {
    match source {
        SupportSourceManifestSourceV1::DesktopNativeFallback
        | SupportSourceManifestSourceV1::RendererLegacy => 0,
        SupportSourceManifestSourceV1::AnyharnessFallback
        | SupportSourceManifestSourceV1::AnyharnessLegacy => 1,
        SupportSourceManifestSourceV1::DesktopWorkerFallback
        | SupportSourceManifestSourceV1::WorkerLegacyV2
        | SupportSourceManifestSourceV1::WorkerLegacyV1 => 2,
        SupportSourceManifestSourceV1::Collector | SupportSourceManifestSourceV1::SessionLedger => {
            0
        }
    }
}

fn file_source_order() -> [SupportSourceManifestSourceV1; 7] {
    [
        SupportSourceManifestSourceV1::DesktopNativeFallback,
        SupportSourceManifestSourceV1::AnyharnessFallback,
        SupportSourceManifestSourceV1::DesktopWorkerFallback,
        SupportSourceManifestSourceV1::RendererLegacy,
        SupportSourceManifestSourceV1::AnyharnessLegacy,
        SupportSourceManifestSourceV1::WorkerLegacyV2,
        SupportSourceManifestSourceV1::WorkerLegacyV1,
    ]
}
