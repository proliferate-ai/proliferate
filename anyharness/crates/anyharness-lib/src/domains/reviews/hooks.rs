use crate::sessions::extensions::{SessionExtension, SessionTurnFinishedContext};

#[derive(Clone)]
pub struct ReviewSessionHooks {
    event_tx: tokio::sync::mpsc::Sender<ReviewHookEvent>,
}

#[derive(Debug, Clone)]
pub enum ReviewHookEvent {
    TurnFinished(SessionTurnFinishedContext),
}

impl ReviewSessionHooks {
    pub fn new(event_tx: tokio::sync::mpsc::Sender<ReviewHookEvent>) -> Self {
        Self { event_tx }
    }
}

impl SessionExtension for ReviewSessionHooks {
    fn on_turn_finished(&self, ctx: SessionTurnFinishedContext) {
        if let Err(error) = self.event_tx.try_send(ReviewHookEvent::TurnFinished(ctx)) {
            tracing::warn!(error = %error, "dropped review hook event; reconciler will recover");
        }
    }
}
