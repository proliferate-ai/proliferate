use super::publish::publish_session_event_strict;
use super::SessionEventSink;
use crate::domains::sessions::prompt::{
    AGENT_PRODUCT_CONTEXT_UNAVAILABLE_CODE, AGENT_PRODUCT_CONTEXT_UNAVAILABLE_DETAIL,
};
use crate::domains::sessions::runtime_event::RuntimeEventInjectionError;
use crate::observability::transcript_phase::record_transcript_phase_event;
use anyharness_contract::v1::{
    ErrorEvent, ErrorEventDetails, SessionEndReason, SessionEndedEvent, SessionEvent,
    SessionEventEnvelope, SessionStartedEvent,
};

impl SessionEventSink {
    pub fn session_started(&mut self, native_session_id: String) {
        self.emit_with_ids(
            SessionEvent::SessionStarted(SessionStartedEvent {
                native_session_id,
                source_agent_kind: self.source_agent_kind.clone(),
            }),
            None,
            None,
        );
    }

    pub fn session_ended(&mut self, reason: SessionEndReason) {
        self.close_open_items();
        self.close_plan_item();
        self.close_tool_items();
        self.emit_with_ids(
            SessionEvent::SessionEnded(SessionEndedEvent { reason }),
            None,
            None,
        );
    }

    pub fn error(&mut self, message: String, code: Option<String>) {
        self.error_with_details(message, code, None);
    }

    pub fn error_with_details(
        &mut self,
        message: String,
        code: Option<String>,
        details: Option<ErrorEventDetails>,
    ) {
        self.close_open_items();
        self.close_plan_item();
        self.close_tool_items();
        let item_id = uuid::Uuid::new_v4().to_string();
        self.emit_with_ids(
            SessionEvent::Error(ErrorEvent {
                message,
                code,
                details,
            }),
            self.current_turn_id.clone(),
            Some(item_id),
        );
    }

    /// Strictly persist the one bounded receipt for a queued prompt whose
    /// per-turn product context could not be resolved. There is deliberately
    /// no turn id: context resolution happens before `TurnStarted`.
    pub(in crate::live::sessions) fn product_context_unavailable(
        &mut self,
        incident_id: String,
    ) -> Result<SessionEventEnvelope, RuntimeEventInjectionError> {
        self.close_open_items();
        self.close_plan_item();
        self.close_tool_items();
        let envelope = publish_session_event_strict(
            &self.session_id,
            &mut self.next_seq,
            &self.event_tx,
            self.store.as_ref(),
            SessionEvent::Error(ErrorEvent {
                message: AGENT_PRODUCT_CONTEXT_UNAVAILABLE_DETAIL.to_string(),
                code: Some(AGENT_PRODUCT_CONTEXT_UNAVAILABLE_CODE.to_string()),
                details: None,
            }),
            None,
            Some(incident_id),
            false,
        )?;
        record_transcript_phase_event(&mut self.transcript_phase_debug, &envelope);
        Ok(envelope)
    }

    pub(super) fn close_open_items(&mut self) {
        let _ = self.close_assistant_item();
        self.close_reasoning_item();
    }
}
