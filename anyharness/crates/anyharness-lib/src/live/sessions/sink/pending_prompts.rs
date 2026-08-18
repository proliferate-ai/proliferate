use super::SessionEventSink;
use crate::domains::sessions::runtime_event::RuntimeEventInjectionError;
use anyharness_contract::v1::{
    PendingPromptAddedPayload, PendingPromptRemovedPayload, PendingPromptUpdatedPayload,
    PendingPromptsReorderedPayload, SessionEvent, SessionEventEnvelope,
};

impl SessionEventSink {
    pub fn pending_prompt_added(&mut self, payload: PendingPromptAddedPayload) {
        self.emit_with_ids(SessionEvent::PendingPromptAdded(payload), None, None);
    }

    pub(in crate::live::sessions) fn pending_prompt_added_strict(
        &mut self,
        payload: PendingPromptAddedPayload,
    ) -> Result<SessionEventEnvelope, RuntimeEventInjectionError> {
        self.inject_session_event_strict(SessionEvent::PendingPromptAdded(payload), false)
    }

    pub fn pending_prompt_updated(&mut self, payload: PendingPromptUpdatedPayload) {
        self.emit_with_ids(SessionEvent::PendingPromptUpdated(payload), None, None);
    }

    pub fn pending_prompt_removed(&mut self, payload: PendingPromptRemovedPayload) {
        self.emit_with_ids(SessionEvent::PendingPromptRemoved(payload), None, None);
    }

    pub fn pending_prompts_reordered(&mut self, payload: PendingPromptsReorderedPayload) {
        self.emit_with_ids(SessionEvent::PendingPromptsReordered(payload), None, None);
    }
}
