use tokio::sync::mpsc;

use super::delivery::CompletionDeliveryStore;
use crate::domains::sessions::extensions::{SessionExtension, SessionTurnFinishedContext};

#[derive(Clone)]
pub struct SubagentSessionHooks {
    delivery_store: CompletionDeliveryStore,
    delivery_nudge: mpsc::UnboundedSender<()>,
}

impl SubagentSessionHooks {
    pub fn new(
        delivery_store: CompletionDeliveryStore,
        delivery_nudge: mpsc::UnboundedSender<()>,
    ) -> Self {
        Self {
            delivery_store,
            delivery_nudge,
        }
    }
}

impl SessionExtension for SubagentSessionHooks {
    fn on_turn_finished(&self, ctx: SessionTurnFinishedContext) {
        let finished_at = chrono::Utc::now().to_rfc3339();
        if let Some(prompt_id) = ctx.prompt_id.as_deref() {
            if self
                .delivery_store
                .mark_delivered_from_parent_turn(
                    &ctx.session_id,
                    prompt_id,
                    &ctx.turn_id,
                    &finished_at,
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
        // Terminal persistence already captured any child delivery intent in
        // the same transaction as the terminal event batch. This is only a
        // latency hint; the periodic worker remains the crash-safe backstop.
        let _ = self.delivery_nudge.send(());
    }
}
