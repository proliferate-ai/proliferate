use super::SubagentService;
use crate::domains::sessions::subagents::delivery::CompletionDeliveryRecord;

impl SubagentService {
    pub fn import_completion_delivery(
        &self,
        delivery: &CompletionDeliveryRecord,
    ) -> anyhow::Result<()> {
        self.subagent_store.import_completion_delivery(delivery)
    }
}
