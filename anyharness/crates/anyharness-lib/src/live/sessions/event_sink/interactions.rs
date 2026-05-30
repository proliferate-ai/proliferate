use super::SessionEventSink;
use anyharness_contract::v1::{
    InteractionKind, InteractionOutcome, InteractionRequestedEvent, InteractionResolvedEvent,
    SessionEvent,
};

impl SessionEventSink {
    pub fn interaction_requested(&mut self, event: InteractionRequestedEvent) {
        self.close_open_items();
        let tool_call_id = event.source.tool_call_id.clone();
        self.emit_with_ids(
            SessionEvent::InteractionRequested(event),
            self.current_turn_id.clone(),
            tool_call_id,
        );
    }

    pub fn interaction_resolved(
        &mut self,
        request_id: String,
        kind: InteractionKind,
        outcome: InteractionOutcome,
    ) {
        self.emit_with_ids(
            SessionEvent::InteractionResolved(InteractionResolvedEvent {
                request_id,
                kind,
                outcome,
            }),
            self.current_turn_id.clone(),
            None,
        );
    }
}
