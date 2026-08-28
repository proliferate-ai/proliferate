use std::collections::BTreeSet;

use chrono::{DateTime, Utc};
use serde::Deserialize;

use super::super::assembly::{
    SupportAssemblyCandidateV1, SupportSessionAssemblyV1, SupportSessionCandidateV1,
};
use super::super::schema::enums::{
    SupportEndpointStateV1, SupportEvidenceSourceV1, SupportLiveConfigStateV1,
    SupportSessionOmissionReasonV1,
};
use super::super::schema::limits::{
    EVENTS_PER_SESSION, EVENT_RESPONSE_BYTES, MAX_SAFE_INTEGER, RAW_NOTIFICATIONS_PER_SESSION,
    RAW_NOTIFICATION_RESPONSE_BYTES, SESSION_LIST_RESPONSE_BYTES,
};
use super::super::schema::model::common::SupportJsonValueV1;
use super::super::schema::model::evidence::SupportSessionEndpointStatesV1;
use super::super::schema::model::manifest::SupportSessionCollectionManifestV1;
use super::super::schema::validate::{validate_id, validate_timestamp};
use super::super::scrub::{SupportExportScrubber, SupportScrubAccounting};
use super::byte_allocation::allocate_exact_response_bytes_refs;
use super::model::{
    BeginSupportSnapshotInput, SupportSnapshotSelectionInput, SupportSnapshotWorkspaceInput,
    SESSION_EVIDENCE_BYTES,
};
pub(super) use super::session_accounting::SessionInputError;
use super::session_accounting::{
    note_endpoint_reason, note_invalid_items, note_live_config_not_collected,
};
use super::session_cross_check::cross_check_collection;
use super::session_values::{
    attach_bytes, own_untrusted_json, scrub_items, scrubbed_summary_is_bound, summary_binding_time,
};

#[path = "session_endpoint.rs"]
mod endpoint;
use endpoint::{summary_presence_is_coherent, validate_endpoint};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SessionCaptureEnvelopeV1 {
    schema_version: u8,
    workspace_id: String,
    anyharness_workspace_id: String,
    selection: SessionSelectionInput,
    source_time_from: String,
    source_time_to: String,
    total_read_bytes: u64,
    session_list: SessionListEndpointV1,
    sessions: Vec<SessionCaptureV1>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum SessionSelectionInput {
    ActiveSession,
    RecentActivity,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SessionCaptureV1 {
    index: u64,
    session_id: String,
    summary: SummaryEndpointV1,
    events: ListEndpointV1,
    raw_notifications: ListEndpointV1,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SummaryEndpointV1 {
    captured_at: String,
    state: EndpointCaptureState,
    reason: Option<EndpointFailureReason>,
    included_bytes: u64,
    window: BoundedWindowMetaV1,
    payload: Option<serde_json::Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SessionListEndpointV1 {
    captured_at: String,
    state: EndpointCaptureState,
    reason: Option<EndpointFailureReason>,
    included_bytes: u64,
    window: BoundedWindowMetaV1,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ListEndpointV1 {
    captured_at: String,
    state: EndpointCaptureState,
    reason: Option<EndpointFailureReason>,
    included_bytes: u64,
    window: BoundedWindowMetaV1,
    payload: Vec<IndexedEvidenceV1>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct IndexedEvidenceV1 {
    pub(super) index: u64,
    pub(super) value: serde_json::Value,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum EndpointCaptureState {
    Included,
    Omitted,
    LimitUncertain,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(super) enum EndpointFailureReason {
    // Explicit renames pin the captured wire strings across the 2026-08-27
    // variant de-prefixing (enum_variant_names).
    #[serde(rename = "session_unavailable")]
    Unavailable,
    #[serde(rename = "session_timeout")]
    Timeout,
    #[serde(rename = "session_invalid")]
    Invalid,
    #[serde(rename = "session_window_limit_uncertain")]
    WindowLimitUncertain,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BoundedWindowMetaV1 {
    schema_version: u8,
    selection: WindowSelectionV1,
    presentation_order: WindowPresentationOrderV1,
    item_limit: u64,
    response_byte_limit: u64,
    returned_items: u64,
    omitted_oversized_items: u64,
    completeness: WindowCompletenessV1,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum WindowSelectionV1 {
    NewestMatching,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum WindowPresentationOrderV1 {
    UpdatedDescIdAsc,
    SeqAsc,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum WindowCompletenessV1 {
    Complete,
    LimitUncertain,
}

pub(super) fn parse_session_input(
    session_evidence_json: Option<&str>,
    collection: &SupportSessionCollectionManifestV1,
    begin: &BeginSupportSnapshotInput,
    source_time_from: &str,
    source_time_to: &str,
    session_phase_started_at: &str,
    scrubber: &SupportExportScrubber,
) -> Result<(SupportSessionAssemblyV1, SupportScrubAccounting), SessionInputError> {
    match (session_evidence_json, collection) {
        (None, SupportSessionCollectionManifestV1::Omitted { reason }) => {
            validate_omitted_binding(*reason, begin)?;
            Ok((
                SupportSessionAssemblyV1::Omitted {
                    captured_at: source_time_to.to_owned(),
                    read_bytes: 0,
                    reason: *reason,
                },
                SupportScrubAccounting::default(),
            ))
        }
        (Some(text), SupportSessionCollectionManifestV1::Included { .. }) => {
            if text.len() > SESSION_EVIDENCE_BYTES {
                return Err(SessionInputError::TooLarge);
            }
            let envelope: SessionCaptureEnvelopeV1 =
                serde_json::from_str(text).map_err(|_| SessionInputError::Invalid)?;
            parse_included(
                envelope,
                collection,
                begin,
                source_time_from,
                source_time_to,
                session_phase_started_at,
                scrubber,
            )
        }
        _ => Err(SessionInputError::Incoherent),
    }
}

fn parse_included(
    envelope: SessionCaptureEnvelopeV1,
    collection: &SupportSessionCollectionManifestV1,
    begin: &BeginSupportSnapshotInput,
    source_time_from: &str,
    source_time_to: &str,
    session_phase_started_at: &str,
    scrubber: &SupportExportScrubber,
) -> Result<(SupportSessionAssemblyV1, SupportScrubAccounting), SessionInputError> {
    let (workspace_id, anyharness_workspace_id, expected_selection, active_session) =
        selected_binding(begin).ok_or(SessionInputError::Incoherent)?;
    if envelope.schema_version != 1
        || envelope.workspace_id != workspace_id
        || envelope.anyharness_workspace_id != anyharness_workspace_id
        || envelope.selection != expected_selection
        || envelope.source_time_from != source_time_from
        || envelope.source_time_to != source_time_to
        || envelope.sessions.len() > 3
        || envelope.total_read_bytes > SESSION_EVIDENCE_BYTES as u64
        || envelope.total_read_bytes > MAX_SAFE_INTEGER
        || validate_timestamp(&envelope.source_time_from).is_err()
        || validate_timestamp(&envelope.source_time_to).is_err()
    {
        return Err(SessionInputError::Incoherent);
    }
    if active_session.is_some() && envelope.sessions.len() != 1 {
        return Err(SessionInputError::Incoherent);
    }
    let summary_item_limit = if active_session.is_some() { 1 } else { 3 };
    let session_list_state = validate_endpoint(
        &envelope.session_list.captured_at,
        envelope.session_list.state,
        envelope.session_list.reason,
        envelope.session_list.included_bytes,
        &envelope.session_list.window,
        summary_item_limit,
        SESSION_LIST_RESPONSE_BYTES,
        WindowPresentationOrderV1::UpdatedDescIdAsc,
        session_phase_started_at,
    )?;
    if active_session.is_none() && session_list_state == SupportEndpointStateV1::Omitted {
        return Err(SessionInputError::Incoherent);
    }
    if active_session.is_none()
        && envelope.session_list.window.returned_items < envelope.sessions.len() as u64
    {
        return Err(SessionInputError::Incoherent);
    }
    let mut accounting = SupportScrubAccounting::default();
    note_endpoint_reason(envelope.session_list.reason, &mut accounting);
    note_invalid_items(
        envelope
            .session_list
            .window
            .returned_items
            .saturating_sub(envelope.sessions.len() as u64),
        &mut accounting,
    );
    let mut sessions = Vec::with_capacity(envelope.sessions.len());
    let session_bytes = envelope.session_list.included_bytes;
    let mut event_bytes = 0_u64;
    let mut raw_bytes = 0_u64;
    let mut uncertain = u64::from(session_list_state == SupportEndpointStateV1::LimitUncertain);
    let mut latest_capture = (
        DateTime::parse_from_rfc3339(&envelope.session_list.captured_at)
            .map_err(|_| SessionInputError::Invalid)?
            .with_timezone(&Utc),
        envelope.session_list.captured_at.clone(),
    );
    let mut selected_session_ids = BTreeSet::new();
    let mut prior_recent_summary: Option<(DateTime<Utc>, String)> = None;
    for (index, session) in envelope.sessions.into_iter().enumerate() {
        if session.index != index as u64
            || validate_id(&session.session_id).is_err()
            || !selected_session_ids.insert(session.session_id.clone())
            || active_session.is_some_and(|expected| expected != session.session_id)
        {
            return Err(SessionInputError::Incoherent);
        }
        let mut summary_state = validate_endpoint(
            &session.summary.captured_at,
            session.summary.state,
            session.summary.reason,
            session.summary.included_bytes,
            &session.summary.window,
            summary_item_limit,
            SESSION_LIST_RESPONSE_BYTES,
            WindowPresentationOrderV1::UpdatedDescIdAsc,
            session_phase_started_at,
        )?;
        let expected_summary_bytes = if index == 0 { session_bytes } else { 0 };
        if session.summary.captured_at != envelope.session_list.captured_at
            || session.summary.state != envelope.session_list.state
            || session.summary.reason != envelope.session_list.reason
            || session.summary.window != envelope.session_list.window
            || session.summary.included_bytes != expected_summary_bytes
            || (index == 0 && session.summary.payload.is_some() && session_bytes == 0)
        {
            return Err(SessionInputError::Incoherent);
        }
        let events_state = validate_endpoint(
            &session.events.captured_at,
            session.events.state,
            session.events.reason,
            session.events.included_bytes,
            &session.events.window,
            EVENTS_PER_SESSION,
            EVENT_RESPONSE_BYTES,
            WindowPresentationOrderV1::SeqAsc,
            session_phase_started_at,
        )?;
        let raw_state = validate_endpoint(
            &session.raw_notifications.captured_at,
            session.raw_notifications.state,
            session.raw_notifications.reason,
            session.raw_notifications.included_bytes,
            &session.raw_notifications.window,
            RAW_NOTIFICATIONS_PER_SESSION,
            RAW_NOTIFICATION_RESPONSE_BYTES,
            WindowPresentationOrderV1::SeqAsc,
            session_phase_started_at,
        )?;
        for endpoint_time in [
            &session.summary.captured_at,
            &session.events.captured_at,
            &session.raw_notifications.captured_at,
        ] {
            let parsed = DateTime::parse_from_rfc3339(endpoint_time)
                .map_err(|_| SessionInputError::Invalid)?
                .with_timezone(&Utc);
            if parsed > latest_capture.0 {
                latest_capture = (parsed, endpoint_time.clone());
            }
        }
        uncertain += [events_state, raw_state]
            .into_iter()
            .filter(|state| *state == SupportEndpointStateV1::LimitUncertain)
            .count() as u64;
        note_endpoint_reason(session.events.reason, &mut accounting);
        note_endpoint_reason(session.raw_notifications.reason, &mut accounting);

        if !summary_presence_is_coherent(
            summary_state,
            session.summary.window.returned_items,
            session.summary.payload.is_some(),
        ) {
            return Err(SessionInputError::Incoherent);
        }
        let summary_time = session.summary.payload.as_ref().and_then(|value| {
            summary_binding_time(
                value,
                &session.session_id,
                &anyharness_workspace_id,
                active_session.is_none().then_some(source_time_from),
                source_time_to,
            )
        });
        if active_session.is_none() {
            let current_time = *summary_time.as_ref().ok_or(SessionInputError::Incoherent)?;
            if prior_recent_summary
                .as_ref()
                .is_some_and(|(prior_time, prior_id)| {
                    current_time > *prior_time
                        || (current_time == *prior_time
                            && session.session_id.as_str() <= prior_id.as_str())
                })
            {
                return Err(SessionInputError::Incoherent);
            }
            prior_recent_summary = Some((current_time, session.session_id.clone()));
        }
        let summary = match session.summary.payload {
            Some(value)
                if summary_state != SupportEndpointStateV1::Omitted
                    && session.summary.window.returned_items > 0
                    && summary_time.is_some() =>
            {
                let value = own_untrusted_json(value)?;
                scrubber
                    .scrub_optional_value(value, SupportEvidenceSourceV1::SessionLedger)
                    .map_err(|_| SessionInputError::Scrub)?
            }
            None if summary_state == SupportEndpointStateV1::Omitted
                || (summary_state == SupportEndpointStateV1::LimitUncertain
                    && session.summary.window.returned_items == 0) =>
            {
                scrubber
                    .scrub_optional_value(
                        SupportJsonValueV1::Null,
                        SupportEvidenceSourceV1::SessionLedger,
                    )
                    .map_err(|_| SessionInputError::Scrub)?
            }
            _ => return Err(SessionInputError::Incoherent),
        };
        let mut summary = if summary_state == SupportEndpointStateV1::Omitted
            || (summary_state == SupportEndpointStateV1::LimitUncertain
                && session.summary.window.returned_items == 0)
        {
            super::super::scrub::SupportOptionalScrubbed {
                value: None,
                accounting: summary.accounting,
            }
        } else {
            summary
        };
        if summary.value.as_ref().is_some_and(|value| {
            !scrubbed_summary_is_bound(
                value,
                &session.session_id,
                &anyharness_workspace_id,
                summary_time.as_ref().expect("present summary binding"),
            )
        }) {
            summary.value = None;
            summary.accounting.omissions.push(
                super::super::schema::model::common::SupportOmissionV1 {
                    source: SupportEvidenceSourceV1::SessionLedger,
                    reason: super::super::schema::enums::SupportOmissionReasonV1::SessionInvalid,
                    count: 1,
                    known_bytes: None,
                },
            );
        }
        if summary.value.is_none() && summary_state == SupportEndpointStateV1::Included {
            summary_state = SupportEndpointStateV1::Omitted;
        }
        let event_payload_count = session.events.payload.len() as u64;
        let raw_payload_count = session.raw_notifications.payload.len() as u64;
        if (events_state == SupportEndpointStateV1::Omitted && event_payload_count != 0)
            || (raw_state == SupportEndpointStateV1::Omitted && raw_payload_count != 0)
            || ((event_payload_count == 0) != (session.events.included_bytes == 0))
            || ((raw_payload_count == 0) != (session.raw_notifications.included_bytes == 0))
            || session.events.window.returned_items < event_payload_count
            || session.raw_notifications.window.returned_items < raw_payload_count
        {
            return Err(SessionInputError::Incoherent);
        }
        let events = scrub_items(
            session.events.payload,
            &session.session_id,
            source_time_from,
            source_time_to,
            scrubber,
        )?;
        let raw = scrub_items(
            session.raw_notifications.payload,
            &session.session_id,
            source_time_from,
            source_time_to,
            scrubber,
        )?;
        note_invalid_items(
            session.events.window.returned_items - events.len() as u64,
            &mut accounting,
        );
        note_invalid_items(
            session.raw_notifications.window.returned_items - raw.len() as u64,
            &mut accounting,
        );
        event_bytes = event_bytes
            .checked_add(session.events.included_bytes)
            .ok_or(SessionInputError::Invalid)?;
        raw_bytes = raw_bytes
            .checked_add(session.raw_notifications.included_bytes)
            .ok_or(SessionInputError::Invalid)?;
        let normalized_events = attach_bytes(events, session.events.included_bytes)?;
        let raw_notifications = attach_bytes(raw, session.raw_notifications.included_bytes)?;
        sessions.push(SupportSessionCandidateV1 {
            selection_index: index as u64,
            session_id: session.session_id,
            summary_captured_at: session.summary.captured_at,
            endpoint_states: SupportSessionEndpointStatesV1 {
                summary: summary_state,
                events: events_state,
                raw_notifications: raw_state,
                live_config: SupportLiveConfigStateV1::NotCollected,
            },
            summary: SupportAssemblyCandidateV1 {
                scrubbed: summary,
                included_bytes: session.summary.included_bytes,
                original_index: 0,
            },
            normalized_events,
            raw_notifications,
        });
    }
    note_live_config_not_collected(sessions.len() as u64, &mut accounting);
    cross_check_collection(
        collection,
        &workspace_id,
        &anyharness_workspace_id,
        sessions.len() as u64,
        session_bytes,
        event_bytes,
        raw_bytes,
        uncertain,
        envelope.total_read_bytes,
    )?;
    let mut summaries = sessions
        .iter_mut()
        .map(|session| &mut session.summary)
        .collect::<Vec<_>>();
    allocate_exact_response_bytes_refs(&mut summaries, session_bytes)
        .map_err(|_| SessionInputError::Incoherent)?;
    Ok((
        SupportSessionAssemblyV1::Included {
            captured_at: latest_capture.1,
            read_bytes: envelope.total_read_bytes,
            session_list_state,
            workspace_id,
            anyharness_workspace_id,
            sessions,
        },
        accounting,
    ))
}

fn selected_binding(
    begin: &BeginSupportSnapshotInput,
) -> Option<(String, String, SessionSelectionInput, Option<&str>)> {
    match &begin.consent.selection {
        SupportSnapshotSelectionInput::ActiveSession {
            workspace,
            materialized_session_id,
            ..
        } => Some((
            workspace.workspace_id.clone(),
            workspace.anyharness_workspace_id.clone(),
            SessionSelectionInput::ActiveSession,
            Some(materialized_session_id.as_str()),
        )),
        SupportSnapshotSelectionInput::RecentActivity {
            workspace:
                SupportSnapshotWorkspaceInput::BundledLocal {
                    workspace_id,
                    anyharness_workspace_id,
                },
        } => Some((
            workspace_id.clone(),
            anyharness_workspace_id.clone(),
            SessionSelectionInput::RecentActivity,
            None,
        )),
        _ => None,
    }
}

fn validate_omitted_binding(
    reason: SupportSessionOmissionReasonV1,
    begin: &BeginSupportSnapshotInput,
) -> Result<(), SessionInputError> {
    let no_workspace = matches!(
        &begin.consent.selection,
        SupportSnapshotSelectionInput::RecentActivity {
            workspace: SupportSnapshotWorkspaceInput::None { .. },
        }
    );
    if no_workspace {
        return (reason == SupportSessionOmissionReasonV1::NoSelectedBundledLocalWorkspace)
            .then_some(())
            .ok_or(SessionInputError::Incoherent);
    }
    match (&begin.consent.selection, reason) {
        (_, SupportSessionOmissionReasonV1::SessionUnavailable)
        | (_, SupportSessionOmissionReasonV1::SessionTimeout)
        | (_, SupportSessionOmissionReasonV1::SessionInvalid) => Ok(()),
        _ => Err(SessionInputError::Incoherent),
    }
}

#[cfg(test)]
#[path = "session_input_tests.rs"]
mod tests;
