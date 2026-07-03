use std::sync::Arc;

use super::runtime::GoalRuntime;
use crate::domains::sessions::extensions::{
    SessionExtension, SessionStartedContext, SessionTurnFinishedContext,
};

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

/// Runtime cap enforcement: on every finished turn, count it against the
/// session's active goal and, if a cap (`max_turns` / `max_wall_secs`) is
/// breached, fail the goal and stop the native loop.
///
/// Turn counting starts when the goal becomes active and only resets when the
/// objective changes (a bare edit keeps the count) — that reset lives in the
/// ingest path, so the guard just counts and enforces. Sessions with no active
/// goal or no caps cost one indexed read per turn and no writes.
///
/// The enforcement work (mirror fail + native clear) is spawned off the
/// synchronous hook, mirroring [`GoalSessionHooks`]; a missing/retired session
/// is a quiet no-op.
pub struct GoalGuardExtension {
    goal_runtime: Arc<GoalRuntime>,
}

impl GoalGuardExtension {
    pub fn new(goal_runtime: Arc<GoalRuntime>) -> Self {
        Self { goal_runtime }
    }
}

impl SessionExtension for GoalGuardExtension {
    fn on_turn_finished(&self, ctx: SessionTurnFinishedContext) {
        let goal_runtime = self.goal_runtime.clone();
        tokio::spawn(async move {
            if let Err(error) = goal_runtime.evaluate_turn_caps(&ctx.session_id).await {
                tracing::warn!(
                    session_id = %ctx.session_id,
                    error = %error,
                    "goal cap guard failed"
                );
            }
        });
    }
}
