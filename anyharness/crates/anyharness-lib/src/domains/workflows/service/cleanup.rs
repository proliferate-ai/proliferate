use super::*;
use crate::domains::workflows::cleanup::{
    WorkflowCleanupFence, WorkflowMaterializationBegin, WorkflowMaterializationCleanupReceipt,
    WorkflowMaterializationIntent, WorkflowMaterializationRecord,
};
use crate::domains::workspaces::model::WorkspaceRecord;

impl WorkflowService {
    pub fn begin_materialization(
        &self,
        intent: &WorkflowMaterializationIntent,
    ) -> anyhow::Result<WorkflowMaterializationBegin> {
        self.store.begin_materialization(intent, &now())
    }

    pub fn record_materialization_cleanup_receipt(
        &self,
        receipt: &WorkflowMaterializationCleanupReceipt,
    ) -> anyhow::Result<()> {
        self.store
            .record_materialization_cleanup_receipt(receipt, &now())
    }

    pub fn mark_materialization_cleanup_required(
        &self,
        intent: &WorkflowMaterializationIntent,
        detail: &str,
    ) -> anyhow::Result<()> {
        self.store
            .mark_materialization_cleanup_required(intent, detail, &now())
    }

    pub fn register_materialized_workspace(
        &self,
        intent: &WorkflowMaterializationIntent,
        workspace: &WorkspaceRecord,
    ) -> anyhow::Result<()> {
        self.store
            .register_materialized_workspace(intent, workspace, &now())?;
        #[cfg(test)]
        if self
            .materialization_persist_failures
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |remaining| {
                (remaining > 0).then(|| remaining - 1)
            })
            .is_ok()
        {
            anyhow::bail!("injected materialization registration response loss");
        }
        Ok(())
    }

    pub fn registered_workspace_for_materialization(
        &self,
        intent: &WorkflowMaterializationIntent,
    ) -> anyhow::Result<Option<String>> {
        self.store.registered_workspace_for_intent(intent)
    }

    pub fn registered_materialization_for_identity(
        &self,
        run_id: &str,
        scope_id: &str,
        execution_generation: i64,
        broker_generation: u64,
    ) -> anyhow::Result<Option<WorkflowMaterializationRecord>> {
        self.store.registered_materialization_for_identity(
            run_id,
            scope_id,
            execution_generation,
            broker_generation,
        )
    }

    pub fn list_unresolved_materializations(
        &self,
        run_id: &str,
    ) -> anyhow::Result<Vec<WorkflowMaterializationRecord>> {
        self.store.list_unresolved_materializations(run_id)
    }

    pub fn unresolved_materialization_run_ids(&self) -> anyhow::Result<Vec<String>> {
        self.store.unresolved_materialization_run_ids()
    }

    pub fn fence_pending_materializations_after_restart(
        &self,
        run_id: &str,
    ) -> anyhow::Result<usize> {
        self.store.fence_pending_materializations_after_restart(
            run_id,
            "runtime restarted before materialization ownership was committed; operation-identity reconciliation required",
            &now(),
        )
    }

    pub fn require_cleanup_fence(
        &self,
        run_id: &str,
        fence_kind: &str,
        fence_key: &str,
        detail: &str,
    ) -> anyhow::Result<()> {
        self.store
            .upsert_cleanup_fence(run_id, fence_kind, fence_key, detail, &now())
    }

    pub fn clear_cleanup_fence(
        &self,
        run_id: &str,
        fence_kind: &str,
        fence_key: &str,
    ) -> anyhow::Result<()> {
        self.store
            .clear_cleanup_fence(run_id, fence_kind, fence_key)
    }

    pub fn list_cleanup_fences(&self, run_id: &str) -> anyhow::Result<Vec<WorkflowCleanupFence>> {
        self.store.list_cleanup_fences(run_id)
    }
}
