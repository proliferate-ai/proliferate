use anyharness_contract::v1::{
    ContentPart, PendingPromptRemovalReason, PromptProvenance, SessionEvent, TranscriptItemKind,
    TranscriptItemPayload, TranscriptItemStatus,
};

pub(in crate::domains::sessions) struct CompletionWakeEventExpectation<'a> {
    pub prompt_id: String,
    pub notification_text: &'a str,
    pub session_link_id: &'a str,
    pub delivery_id: &'a str,
    pub label: Option<&'a str>,
}

pub(in crate::domains::sessions) enum PersistedCompletionWakeEvent {
    TurnStarted,
    ItemStarted {
        item_value: serde_json::Value,
    },
    ItemCompleted {
        item_value: serde_json::Value,
    },
    PendingPromptRemoved {
        seq: i64,
        prompt_id: Option<String>,
        executed: bool,
    },
}

pub(in crate::domains::sessions) fn persisted_completion_wake_event(
    event_type: &str,
    payload_json: &str,
    expected: &CompletionWakeEventExpectation<'_>,
) -> Option<PersistedCompletionWakeEvent> {
    let event = serde_json::from_str::<SessionEvent>(payload_json).ok()?;
    if event.event_type() != event_type {
        return None;
    }
    match event {
        SessionEvent::TurnStarted(_) => Some(PersistedCompletionWakeEvent::TurnStarted),
        SessionEvent::ItemStarted(started)
            if completion_wake_item_matches(&started.item, expected) =>
        {
            Some(PersistedCompletionWakeEvent::ItemStarted {
                item_value: serde_json::to_value(started.item).ok()?,
            })
        }
        SessionEvent::ItemCompleted(completed)
            if completion_wake_item_matches(&completed.item, expected) =>
        {
            Some(PersistedCompletionWakeEvent::ItemCompleted {
                item_value: serde_json::to_value(completed.item).ok()?,
            })
        }
        SessionEvent::PendingPromptRemoved(removed) => {
            Some(PersistedCompletionWakeEvent::PendingPromptRemoved {
                seq: removed.seq,
                prompt_id: removed.prompt_id,
                executed: removed.reason == PendingPromptRemovalReason::Executed,
            })
        }
        _ => None,
    }
}

fn completion_wake_item_matches(
    item: &TranscriptItemPayload,
    expected: &CompletionWakeEventExpectation<'_>,
) -> bool {
    let provenance_matches = matches!(
        item.prompt_provenance.as_ref(),
        Some(PromptProvenance::SubagentWake {
            session_link_id,
            completion_id,
            label,
        }) if session_link_id == expected.session_link_id
            && completion_id == expected.delivery_id
            && label.as_deref() == expected.label
    );
    matches!(item.kind, TranscriptItemKind::UserMessage)
        && matches!(item.status, TranscriptItemStatus::Completed)
        && !item.is_transient
        && item.message_id.is_none()
        && item.prompt_id.as_deref() == Some(expected.prompt_id.as_str())
        && item.title.is_none()
        && item.tool_call_id.is_none()
        && item.native_tool_name.is_none()
        && item.parent_tool_call_id.is_none()
        && item.raw_input.is_none()
        && item.raw_output.is_none()
        && matches!(
            item.content_parts.as_slice(),
            [ContentPart::Text { text }] if text == expected.notification_text
        )
        && provenance_matches
}
