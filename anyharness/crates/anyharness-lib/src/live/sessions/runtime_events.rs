use anyharness_contract::v1::{
    PendingPromptRemovalReason, PendingPromptRemovedPayload, SessionEvent,
    SessionInfoUpdatePayload, WorkspacePinIntentPayload,
};

use crate::domains::sessions::runtime_event::RuntimeInjectedSessionEvent;

pub(in crate::live::sessions) fn into_session_event(
    event: RuntimeInjectedSessionEvent,
) -> SessionEvent {
    match event {
        RuntimeInjectedSessionEvent::SessionInfoUpdate { title, updated_at } => {
            SessionEvent::SessionInfoUpdate(SessionInfoUpdatePayload { title, updated_at })
        }
        RuntimeInjectedSessionEvent::WorkspacePinIntent {
            request_id,
            runtime_id,
            source_session_id,
            workspace_id,
            pinned,
        } => SessionEvent::WorkspacePinIntent(WorkspacePinIntentPayload {
            request_id,
            runtime_id,
            source_session_id,
            workspace_id,
            pinned,
        }),
        RuntimeInjectedSessionEvent::PendingPromptRemoved { seq, prompt_id } => {
            SessionEvent::PendingPromptRemoved(PendingPromptRemovedPayload {
                seq,
                prompt_id,
                reason: PendingPromptRemovalReason::Deleted,
            })
        }
        RuntimeInjectedSessionEvent::SubagentTurnCompleted(payload) => {
            SessionEvent::SubagentTurnCompleted(payload)
        }
        RuntimeInjectedSessionEvent::SessionLinkTurnCompleted(payload) => {
            SessionEvent::SessionLinkTurnCompleted(payload)
        }
        RuntimeInjectedSessionEvent::ReviewRunUpdated(payload) => {
            SessionEvent::ReviewRunUpdated(payload)
        }
    }
}
