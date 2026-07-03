use std::collections::HashMap;

use anyharness_contract::v1::Goal;

/// Read port for the session read-side: resolves the goal mirror the goals
/// domain keeps, without the sessions domain depending on goal internals.
pub trait ActiveGoalResolver: Send + Sync {
    fn active_goal(&self, session_id: &str) -> anyhow::Result<Option<Goal>>;

    fn active_goals_for_sessions(
        &self,
        session_ids: &[String],
    ) -> anyhow::Result<HashMap<String, Goal>>;
}
