use tokio::sync::mpsc;

use super::delivery::{
    CaptureCompletionDeliveryInput, CaptureCompletionDeliveryOutcome, CompletionDeliveryStore,
};
use super::transcript::summarize_turn_events;
use crate::domains::sessions::extensions::{SessionExtension, SessionTurnFinishedContext};
use crate::domains::sessions::store::SessionStore;

#[derive(Clone)]
pub struct SubagentSessionHooks {
    session_store: SessionStore,
    delivery_store: CompletionDeliveryStore,
    delivery_nudge: mpsc::UnboundedSender<()>,
}

impl SubagentSessionHooks {
    pub fn new(
        session_store: SessionStore,
        delivery_store: CompletionDeliveryStore,
        delivery_nudge: mpsc::UnboundedSender<()>,
    ) -> Self {
        Self {
            session_store,
            delivery_store,
            delivery_nudge,
        }
    }
}

impl SessionExtension for SubagentSessionHooks {
    fn on_turn_finished(&self, ctx: SessionTurnFinishedContext) {
        let captured_at = chrono::Utc::now().to_rfc3339();
        if let Some(prompt_id) = ctx.prompt_id.as_deref() {
            if self
                .delivery_store
                .mark_delivered_from_parent_turn(
                    &ctx.session_id,
                    prompt_id,
                    &ctx.turn_id,
                    &captured_at,
                )
                .is_err()
            {
                tracing::warn!(
                    session_id = %ctx.session_id,
                    failure_code = "parent_turn_reconcile_failed",
                    "failed to reconcile completion delivery from parent turn"
                );
            }
        }
        if ctx.turn_id.trim().is_empty() {
            return;
        }
        let assistant_text = match self.session_store.list_events_for_turn_through_seq(
            &ctx.session_id,
            &ctx.turn_id,
            ctx.last_event_seq,
        ) {
            Ok(events) => summarize_turn_events(&events).0,
            Err(_) => {
                tracing::warn!(
                    child_session_id = %ctx.session_id,
                    child_turn_id = %ctx.turn_id,
                    failure_code = "turn_summary_unavailable",
                    "capturing subagent completion without assistant summary"
                );
                None
            }
        };
        let input = CaptureCompletionDeliveryInput {
            turn: ctx,
            assistant_text,
            captured_at,
        };
        match self.delivery_store.capture(&input) {
            Ok(CaptureCompletionDeliveryOutcome::Captured { delivery, .. }) => {
                tracing::info!(
                    delivery_id = %delivery.delivery_id,
                    result_class = "captured",
                    "subagent completion delivery captured"
                );
                let _ = self.delivery_nudge.send(());
            }
            Ok(CaptureCompletionDeliveryOutcome::NotSubagent) => {}
            Err(_) => tracing::warn!(
                child_session_id = %input.turn.session_id,
                child_turn_id = %input.turn.turn_id,
                failure_code = "completion_capture_failed",
                "failed to capture subagent completion delivery"
            ),
        }
    }
}
