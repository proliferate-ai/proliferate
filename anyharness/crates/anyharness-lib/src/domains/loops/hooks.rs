use std::sync::Arc;

use super::runtime::LoopRuntime;
use crate::domains::sessions::extensions::{
    SessionClosingActions, SessionClosingContext, SessionExtension, SessionStartedContext,
    SessionTurnFinishedContext,
};

/// Loop lifecycle hooks:
/// - **attach** → reconcile (native `loop/list` pull; emulated scheduler
///   re-arm from persisted `native: false` loops).
/// - **turn finished** → nudge the scheduler so a loop skipped while the
///   session was busy can fire now that it is idle.
/// - **closing** → drop the session's in-memory timers (mortal muscle; the
///   sqlite rows re-arm on the next attach).
pub struct LoopSessionHooks {
    loop_runtime: Arc<LoopRuntime>,
}

impl LoopSessionHooks {
    pub fn new(loop_runtime: Arc<LoopRuntime>) -> Self {
        Self { loop_runtime }
    }
}

impl SessionExtension for LoopSessionHooks {
    fn on_session_started(&self, ctx: SessionStartedContext) {
        let loop_runtime = self.loop_runtime.clone();
        tokio::spawn(async move {
            if let Err(error) = loop_runtime.reconcile_on_attach(&ctx.session_id).await {
                tracing::warn!(
                    session_id = %ctx.session_id,
                    error = %error,
                    "loop reconcile-on-attach failed"
                );
            }
        });
    }

    fn on_turn_finished(&self, _ctx: SessionTurnFinishedContext) {
        self.loop_runtime.scheduler().notify();
    }

    fn on_session_closing(
        &self,
        ctx: SessionClosingContext,
    ) -> anyhow::Result<SessionClosingActions> {
        let loop_runtime = self.loop_runtime.clone();
        tokio::spawn(async move {
            loop_runtime.scheduler().disarm_session(&ctx.session_id).await;
        });
        Ok(SessionClosingActions::default())
    }
}
