use std::sync::Arc;

use super::SessionEventSink;
use crate::domains::sessions::extensions::{
    SessionInteractionRequestedContext, SessionInteractionResolvedContext,
};
use anyharness_contract::v1::{
    InteractionKind, InteractionOutcome, InteractionRequestedEvent, InteractionResolvedEvent,
    SessionEvent,
};

impl SessionEventSink {
    pub(in crate::live::sessions) fn set_interaction_hooks(
        &mut self,
        on_interaction_requested: Option<
            Arc<dyn Fn(SessionInteractionRequestedContext) + Send + Sync>,
        >,
        on_interaction_resolved: Option<
            Arc<dyn Fn(SessionInteractionResolvedContext) + Send + Sync>,
        >,
    ) {
        self.on_interaction_requested = on_interaction_requested;
        self.on_interaction_resolved = on_interaction_resolved;
    }

    pub fn interaction_requested(&mut self, event: InteractionRequestedEvent) {
        self.close_open_items();
        let tool_call_id = event.source.tool_call_id.clone();
        if let Some(hook) = self.on_interaction_requested.clone() {
            hook(SessionInteractionRequestedContext {
                session_id: self.session_id.clone(),
                request_id: event.request_id.clone(),
                kind: event.kind.clone(),
            });
        }
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
        if let Some(hook) = self.on_interaction_resolved.clone() {
            hook(SessionInteractionResolvedContext {
                session_id: self.session_id.clone(),
                request_id: request_id.clone(),
                kind: kind.clone(),
                outcome: outcome.clone(),
            });
        }
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
