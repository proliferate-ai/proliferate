use tokio::sync::mpsc;

use crate::domains::sessions::extensions::{SessionExtension, SessionTurnFinishedContext};

#[derive(Clone)]
pub struct SubagentSessionHooks {
    delivery_nudge: mpsc::UnboundedSender<()>,
}

impl SubagentSessionHooks {
    pub fn new(delivery_nudge: mpsc::UnboundedSender<()>) -> Self {
        Self { delivery_nudge }
    }
}

impl SessionExtension for SubagentSessionHooks {
    fn on_turn_finished(&self, ctx: SessionTurnFinishedContext) {
        if ctx.turn_id.trim().is_empty() {
            return;
        }
        // Terminal persistence already captured any child delivery intent in
        // the same transaction as the terminal event batch. This is only a
        // latency hint; the periodic worker remains the crash-safe backstop.
        let _ = self.delivery_nudge.send(());
    }
}
