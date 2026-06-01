use std::time::Instant;

#[cfg(test)]
use super::super::branch_refresh::BranchRefreshBatchOutcome;
use super::WorkspaceRuntime;
use crate::workspaces::model::WorkspaceRecord;
use crate::workspaces::types::{ProjectSetupDetectionResult, SetWorkspaceDisplayNameError};

impl WorkspaceRuntime {
    pub fn get_workspace(&self, workspace_id: &str) -> anyhow::Result<Option<WorkspaceRecord>> {
        let record = self.store.find_by_id(workspace_id)?;
        if let Some(record) = record.as_ref() {
            self.branch_refresh
                .schedule_refresh(self.store.clone(), std::slice::from_ref(record));
        }
        Ok(record)
    }

    pub fn delete_workspace_record(&self, workspace_id: &str) -> anyhow::Result<()> {
        self.delete_workflow.delete_workspace_record(workspace_id)
    }

    pub fn set_display_name(
        &self,
        workspace_id: &str,
        display_name: Option<&str>,
    ) -> Result<WorkspaceRecord, SetWorkspaceDisplayNameError> {
        self.service.set_display_name(workspace_id, display_name)
    }

    pub fn detect_setup(&self, workspace_id: &str) -> anyhow::Result<ProjectSetupDetectionResult> {
        self.service.detect_setup(workspace_id)
    }

    pub fn list_workspaces(&self) -> anyhow::Result<Vec<WorkspaceRecord>> {
        let started = Instant::now();
        let store_started = Instant::now();
        let records = self.store.list_execution_surfaces()?;
        tracing::info!(
            workspace_count = records.len(),
            elapsed_ms = store_started.elapsed().as_millis(),
            total_elapsed_ms = started.elapsed().as_millis(),
            "[anyharness-latency] workspace.runtime.list.store_loaded"
        );

        let schedule_started = Instant::now();
        let branch_refresh = self
            .branch_refresh
            .schedule_refresh(self.store.clone(), &records);
        tracing::info!(
            workspace_count = records.len(),
            branch_refresh_scheduled_count = branch_refresh.scheduled_count,
            elapsed_ms = schedule_started.elapsed().as_millis(),
            total_elapsed_ms = started.elapsed().as_millis(),
            "[anyharness-latency] workspace.runtime.list.ready"
        );
        Ok(records)
    }

    #[cfg(test)]
    pub(super) fn refresh_workspace_branches_for_test(
        &self,
    ) -> anyhow::Result<BranchRefreshBatchOutcome> {
        let records = self.store.list_execution_surfaces()?;
        Ok(self
            .branch_refresh
            .run_refresh_for_test(self.store.clone(), &records))
    }

    #[cfg(test)]
    pub(super) fn scheduled_branch_refresh_batches_for_test(&self) -> u64 {
        self.branch_refresh.scheduled_batch_count_for_test()
    }
}
