use std::collections::HashMap;

use anyharness_contract::v1::Goal;

use super::model::GoalRecord;
use super::service::GoalService;
use crate::domains::sessions::active_goals::ActiveGoalResolver;

impl ActiveGoalResolver for GoalService {
    fn active_goal(&self, session_id: &str) -> anyhow::Result<Option<Goal>> {
        Ok(self
            .current_goal(session_id)?
            .as_ref()
            .map(GoalRecord::to_contract))
    }

    fn active_goals_for_sessions(
        &self,
        session_ids: &[String],
    ) -> anyhow::Result<HashMap<String, Goal>> {
        Ok(self
            .store()
            .find_current_for_sessions(session_ids)?
            .into_iter()
            .map(|(session_id, goal)| (session_id, goal.to_contract()))
            .collect())
    }
}
