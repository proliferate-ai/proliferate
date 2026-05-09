use super::SessionEventSink;
use anyharness_contract::v1::{
    ErrorEvent, ErrorEventDetails, SessionEndReason, SessionEndedEvent, SessionEvent,
    SessionStartedEvent,
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

    pub(super) fn close_open_items(&mut self) {
        let _ = self.close_assistant_item();
        self.close_reasoning_item();
    }
}
