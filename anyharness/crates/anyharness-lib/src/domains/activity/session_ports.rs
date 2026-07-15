use std::collections::HashMap;

use anyharness_contract::v1::{ActivityProcess, ActivitySubagent};

use super::service::ActivityService;
use crate::domains::sessions::active_activity_roster::ActivityRosterResolver;

impl ActivityRosterResolver for ActivityService {
    fn activity_roster(
        &self,
        session_id: &str,
    ) -> anyhow::Result<(Vec<ActivityProcess>, Vec<ActivitySubagent>)> {
        self.current_roster(session_id)
    }

    fn activity_rosters_for_sessions(
        &self,
        session_ids: &[String],
    ) -> anyhow::Result<HashMap<String, (Vec<ActivityProcess>, Vec<ActivitySubagent>)>> {
        self.current_rosters_for_sessions(session_ids)
    }
}
