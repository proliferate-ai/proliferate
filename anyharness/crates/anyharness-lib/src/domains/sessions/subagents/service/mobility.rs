use super::SubagentService;
use crate::domains::sessions::subagents::delivery::CompletionDeliveryRecord;

impl SubagentService {
    pub fn completion_deliveries_for_parent_sessions(
        &self,
        parent_session_ids: &[String],
    ) -> anyhow::Result<Vec<CompletionDeliveryRecord>> {
        self.subagent_store
            .list_for_parent_sessions(parent_session_ids)
    }

    pub fn import_completion_delivery(
        &self,
        delivery: &CompletionDeliveryRecord,
    ) -> anyhow::Result<()> {
        self.subagent_store.import_completion_delivery(delivery)
    }
}
