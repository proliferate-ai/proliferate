use std::sync::Arc;

use super::service::ReviewService;
use crate::sessions::extensions::{
    SessionClosingActions, SessionClosingContext, SessionExtension, SessionTurnFinishedContext,
};

#[derive(Clone)]
pub struct ReviewSessionHooks {
    event_tx: tokio::sync::mpsc::Sender<ReviewHookEvent>,
    service: Arc<ReviewService>,
}

#[derive(Debug, Clone)]
pub enum ReviewHookEvent {
    TurnFinished(SessionTurnFinishedContext),
}

impl ReviewSessionHooks {
    pub fn new(
        event_tx: tokio::sync::mpsc::Sender<ReviewHookEvent>,
        service: Arc<ReviewService>,
    ) -> Self {
        Self { event_tx, service }
    }
}

impl SessionExtension for ReviewSessionHooks {
    fn on_session_closing(
        &self,
        ctx: SessionClosingContext,
    ) -> anyhow::Result<SessionClosingActions> {
        let close_session_ids = self
            .service
            .stop_active_run_for_parent(&ctx.session_id)
            .map_err(|error| anyhow::anyhow!(error.to_string()))?;
        Ok(SessionClosingActions { close_session_ids })
    }

    fn on_turn_finished(&self, ctx: SessionTurnFinishedContext) {
        if let Err(error) = self.event_tx.try_send(ReviewHookEvent::TurnFinished(ctx)) {
            tracing::warn!(error = %error, "dropped review hook event; reconciler will recover");
        }
    }
}
