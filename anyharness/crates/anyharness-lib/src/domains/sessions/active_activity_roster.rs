use std::collections::HashMap;

use anyharness_contract::v1::{ActivityProcess, ActivitySubagent};

/// Read port for the session read-side: resolves the read-only activity
/// rosters (background processes + harness-native subagents) the activity
/// domain keeps, without the sessions domain depending on activity
/// internals. Mirrors [`super::active_goals::ActiveGoalResolver`].
pub trait ActivityRosterResolver: Send + Sync {
    fn activity_roster(
        &self,
        session_id: &str,
    ) -> anyhow::Result<(Vec<ActivityProcess>, Vec<ActivitySubagent>)>;

    #[allow(clippy::type_complexity)]
    fn activity_rosters_for_sessions(
        &self,
        session_ids: &[String],
    ) -> anyhow::Result<HashMap<String, (Vec<ActivityProcess>, Vec<ActivitySubagent>)>>;
}
