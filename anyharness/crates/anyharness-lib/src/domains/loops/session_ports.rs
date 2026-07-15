use std::collections::HashMap;

use anyharness_contract::v1::Loop;

use super::model::LoopRecord;
use super::service::LoopService;
use crate::domains::sessions::active_loops::LoopsResolver;

impl LoopsResolver for LoopService {
    fn active_loops(&self, session_id: &str) -> anyhow::Result<Vec<Loop>> {
        Ok(self
            .current_loops(session_id)?
            .iter()
            .map(LoopRecord::to_contract)
            .collect())
    }

    fn active_loops_for_sessions(
        &self,
        session_ids: &[String],
    ) -> anyhow::Result<HashMap<String, Vec<Loop>>> {
        Ok(self
            .current_loops_for_sessions(session_ids)?
            .into_iter()
            .map(|(session_id, loops)| {
                (
                    session_id,
                    loops.iter().map(LoopRecord::to_contract).collect(),
                )
            })
            .collect())
    }
}
