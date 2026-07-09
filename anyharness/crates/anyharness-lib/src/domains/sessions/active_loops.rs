use std::collections::HashMap;

use anyharness_contract::v1::Loop;

/// Read port for the session read-side: resolves the active-loop mirror the
/// loops domain keeps, without the sessions domain depending on loop
/// internals. Mirrors [`super::active_goals::ActiveGoalResolver`]; unlike
/// goals, a session may have many active loops.
pub trait LoopsResolver: Send + Sync {
    fn active_loops(&self, session_id: &str) -> anyhow::Result<Vec<Loop>>;

    fn active_loops_for_sessions(
        &self,
        session_ids: &[String],
    ) -> anyhow::Result<HashMap<String, Vec<Loop>>>;
}
