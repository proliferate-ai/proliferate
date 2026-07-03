use std::sync::Arc;

use super::runtime::GoalRuntime;
use crate::domains::sessions::extensions::{SessionExtension, SessionStartedContext};

/// Attach-time reconcile: whenever a session's live actor comes up (fresh,
/// resumed, or forked), pull the native goal state and heal the mirror.
/// Fire-and-forget — sessions without goal support no-op inside the runtime.
pub struct GoalSessionHooks {
    goal_runtime: Arc<GoalRuntime>,
}

impl GoalSessionHooks {
    pub fn new(goal_runtime: Arc<GoalRuntime>) -> Self {
        Self { goal_runtime }
    }
}

impl SessionExtension for GoalSessionHooks {
    fn on_session_started(&self, ctx: SessionStartedContext) {
        let goal_runtime = self.goal_runtime.clone();
        tokio::spawn(async move {
            if let Err(error) = goal_runtime.reconcile_on_attach(&ctx.session_id).await {
                tracing::warn!(
                    session_id = %ctx.session_id,
                    error = %error,
                    "goal reconcile-on-attach failed"
                );
            }
        });
    }
}
