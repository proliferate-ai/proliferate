use std::collections::HashMap;
use std::sync::OnceLock;

use anyharness_contract::v1::{
    SessionEvent, SessionEventEnvelope, TranscriptItemKind, TranscriptItemStatus,
};

#[derive(Debug, Clone)]
struct ActiveTranscriptItem {
    started_at_ms: i64,
    kind: &'static str,
    source_agent_kind: String,
    native_tool_name: Option<String>,
    title: Option<String>,
    is_transient: Option<bool>,
}

#[derive(Debug, Clone, Default)]
pub struct TranscriptPhaseDebugState {
    previous_event_timestamp_ms: Option<i64>,
    previous_event_type: Option<&'static str>,
    previous_phase_kind: Option<&'static str>,
    last_source_agent_kind: Option<String>,
    active_items: HashMap<String, ActiveTranscriptItem>,
}

#[derive(Debug, Clone)]
struct TranscriptPhaseDescription {
    phase_kind: &'static str,
    phase_state: &'static str,
    source_agent_kind: Option<String>,
    item_kind: Option<&'static str>,
    item_status: Option<&'static str>,
    native_tool_name: Option<String>,
    title: Option<String>,
    is_transient: Option<bool>,
    item_duration_ms: Option<i64>,
}

pub fn record_transcript_phase_event(
    state: &mut TranscriptPhaseDebugState,
    envelope: &SessionEventEnvelope,
) {
    let event_timestamp_ms = timestamp_ms(&envelope.timestamp);
    let description = describe_event(state, envelope, event_timestamp_ms);
    if transcript_phase_debug_enabled() {
        let source_agent_kind = description
            .source_agent_kind
            .as_deref()
            .or(state.last_source_agent_kind.as_deref());
        tracing::info!(
            session_id = %envelope.session_id,
            seq = envelope.seq,
            event_type = envelope.event.event_type(),
            turn_id = envelope.turn_id.as_deref(),
            item_id = envelope.item_id.as_deref(),
            phase_kind = description.phase_kind,
            phase_state = description.phase_state,
            previous_event_type = state.previous_event_type,
            previous_phase_kind = state.previous_phase_kind,
            ms_since_previous_event = diff_ms(event_timestamp_ms, state.previous_event_timestamp_ms),
            item_duration_ms = description.item_duration_ms,
            source_agent_kind = source_agent_kind,
            item_kind = description.item_kind,
            item_status = description.item_status,
            native_tool_name = description.native_tool_name.as_deref(),
            title = description.title.as_deref(),
            is_transient = description.is_transient,
            "[transcript-phase] anyharness normalized event"
        );
    }
    update_state(state, envelope, &description, event_timestamp_ms);
}

fn describe_event(
    state: &TranscriptPhaseDebugState,
    envelope: &SessionEventEnvelope,
    event_timestamp_ms: Option<i64>,
) -> TranscriptPhaseDescription {
    match &envelope.event {
        SessionEvent::SessionStarted(payload) => TranscriptPhaseDescription {
            phase_kind: "other_event",
            phase_state: "event",
            source_agent_kind: Some(payload.source_agent_kind.clone()),
            item_kind: None,
            item_status: None,
            native_tool_name: None,
            title: None,
            is_transient: None,
            item_duration_ms: None,
        },
        SessionEvent::TurnStarted(_) => basic_description("turn", "started"),
        SessionEvent::TurnEnded(_) => basic_description("turn", "ended"),
        SessionEvent::ItemStarted(payload) => TranscriptPhaseDescription {
            phase_kind: phase_kind_for_item_kind(&payload.item.kind),
            phase_state: "started",
            source_agent_kind: Some(payload.item.source_agent_kind.clone()),
            item_kind: Some(item_kind_label(&payload.item.kind)),
            item_status: Some(item_status_label(&payload.item.status)),
            native_tool_name: payload.item.native_tool_name.clone(),
            title: payload.item.title.clone(),
            is_transient: Some(payload.item.is_transient),
            item_duration_ms: None,
        },
        SessionEvent::ItemCompleted(payload) => {
            let previous = envelope
                .item_id
                .as_ref()
                .and_then(|item_id| state.active_items.get(item_id));
            TranscriptPhaseDescription {
                phase_kind: phase_kind_for_item_kind(&payload.item.kind),
                phase_state: "completed",
                source_agent_kind: Some(payload.item.source_agent_kind.clone()),
                item_kind: Some(item_kind_label(&payload.item.kind)),
                item_status: Some(item_status_label(&payload.item.status)),
                native_tool_name: payload
                    .item
                    .native_tool_name
                    .clone()
                    .or_else(|| previous.and_then(|item| item.native_tool_name.clone())),
                title: payload
                    .item
                    .title
                    .clone()
                    .or_else(|| previous.and_then(|item| item.title.clone())),
                is_transient: Some(payload.item.is_transient),
                item_duration_ms: previous
                    .and_then(|item| diff_ms(event_timestamp_ms, Some(item.started_at_ms))),
            }
        }
        SessionEvent::ItemDelta(payload) => {
            let previous = envelope
                .item_id
                .as_ref()
                .and_then(|item_id| state.active_items.get(item_id));
            TranscriptPhaseDescription {
                phase_kind: previous.map(|item| item.kind).unwrap_or("other_event"),
                phase_state: "delta",
                source_agent_kind: previous.map(|item| item.source_agent_kind.clone()),
                item_kind: previous.map(|item| item.kind),
                item_status: payload.delta.status.as_ref().map(item_status_label),
                native_tool_name: payload
                    .delta
                    .native_tool_name
                    .clone()
                    .or_else(|| previous.and_then(|item| item.native_tool_name.clone())),
                title: payload
                    .delta
                    .title
                    .clone()
                    .or_else(|| previous.and_then(|item| item.title.clone())),
                is_transient: payload
                    .delta
                    .is_transient
                    .or_else(|| previous.and_then(|item| item.is_transient)),
                item_duration_ms: None,
            }
        }
        _ => basic_description("other_event", "event"),
    }
}

fn update_state(
    state: &mut TranscriptPhaseDebugState,
    envelope: &SessionEventEnvelope,
    description: &TranscriptPhaseDescription,
    event_timestamp_ms: Option<i64>,
) {
    if let Some(source_agent_kind) = description.source_agent_kind.as_ref() {
        state.last_source_agent_kind = Some(source_agent_kind.clone());
    }
    match &envelope.event {
        SessionEvent::ItemStarted(payload) => {
            if let (Some(item_id), Some(started_at_ms)) =
                (envelope.item_id.as_ref(), event_timestamp_ms)
            {
                state.active_items.insert(
                    item_id.clone(),
                    ActiveTranscriptItem {
                        started_at_ms,
                        kind: item_kind_label(&payload.item.kind),
                        source_agent_kind: payload.item.source_agent_kind.clone(),
                        native_tool_name: payload.item.native_tool_name.clone(),
                        title: payload.item.title.clone(),
                        is_transient: Some(payload.item.is_transient),
                    },
                );
            }
        }
        SessionEvent::ItemDelta(payload) => {
            if let Some(item_id) = envelope.item_id.as_ref() {
                if let Some(item) = state.active_items.get_mut(item_id) {
                    item.native_tool_name = payload
                        .delta
                        .native_tool_name
                        .clone()
                        .or_else(|| item.native_tool_name.clone());
                    item.title = payload.delta.title.clone().or_else(|| item.title.clone());
                    item.is_transient = payload.delta.is_transient.or(item.is_transient);
                }
            }
        }
        SessionEvent::ItemCompleted(_) => {
            if let Some(item_id) = envelope.item_id.as_ref() {
                state.active_items.remove(item_id);
            }
        }
        _ => {}
    }
    state.previous_event_timestamp_ms = event_timestamp_ms;
    state.previous_event_type = Some(envelope.event.event_type());
    state.previous_phase_kind = Some(description.phase_kind);
}

fn basic_description(
    phase_kind: &'static str,
    phase_state: &'static str,
) -> TranscriptPhaseDescription {
    TranscriptPhaseDescription {
        phase_kind,
        phase_state,
        source_agent_kind: None,
        item_kind: None,
        item_status: None,
        native_tool_name: None,
        title: None,
        is_transient: None,
        item_duration_ms: None,
    }
}

fn phase_kind_for_item_kind(kind: &TranscriptItemKind) -> &'static str {
    match kind {
        TranscriptItemKind::AssistantMessage => "assistant_message",
        TranscriptItemKind::Reasoning => "reasoning",
        TranscriptItemKind::ToolInvocation => "tool_invocation",
        TranscriptItemKind::UserMessage => "user_message",
        _ => "other_item",
    }
}

fn item_kind_label(kind: &TranscriptItemKind) -> &'static str {
    match kind {
        TranscriptItemKind::UserMessage => "user_message",
        TranscriptItemKind::AssistantMessage => "assistant_message",
        TranscriptItemKind::Reasoning => "reasoning",
        TranscriptItemKind::ToolInvocation => "tool_invocation",
        TranscriptItemKind::Plan => "plan",
        TranscriptItemKind::ProposedPlan => "proposed_plan",
        TranscriptItemKind::ErrorItem => "error_item",
    }
}

fn item_status_label(status: &TranscriptItemStatus) -> &'static str {
    match status {
        TranscriptItemStatus::InProgress => "in_progress",
        TranscriptItemStatus::Completed => "completed",
        TranscriptItemStatus::Failed => "failed",
    }
}

fn diff_ms(later_ms: Option<i64>, earlier_ms: Option<i64>) -> Option<i64> {
    Some(later_ms?.saturating_sub(earlier_ms?))
}

fn timestamp_ms(timestamp: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(timestamp)
        .ok()
        .map(|value| value.timestamp_millis())
}

fn transcript_phase_debug_enabled() -> bool {
    static ENABLED: OnceLock<bool> = OnceLock::new();
    *ENABLED.get_or_init(|| env_flag_enabled("ANYHARNESS_DEBUG_TRANSCRIPT_PHASES"))
}

fn env_flag_enabled(name: &str) -> bool {
    std::env::var(name)
        .ok()
        .map(|value| {
            let normalized = value.trim().to_ascii_lowercase();
            !normalized.is_empty() && !matches!(normalized.as_str(), "0" | "false" | "off" | "no")
        })
        .unwrap_or(false)
}
