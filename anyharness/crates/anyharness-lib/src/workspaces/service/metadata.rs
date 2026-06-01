use std::path::Path;

use super::{WorkspaceService, MAX_WORKSPACE_DISPLAY_NAME_CHARS};
use crate::workspaces::detector;
use crate::workspaces::model::WorkspaceRecord;
use crate::workspaces::types::{ProjectSetupDetectionResult, SetWorkspaceDisplayNameError};

impl WorkspaceService {
    pub fn get_workspace(&self, id: &str) -> anyhow::Result<Option<WorkspaceRecord>> {
        self.store
            .find_by_id(id)?
            .map(|record| self.reconcile_current_branch(record))
            .transpose()
    }

    /// Set or clear the user-provided workspace display name.
    ///
    /// `display_name` is trimmed; an empty string clears the override.
    pub fn set_display_name(
        &self,
        workspace_id: &str,
        display_name: Option<&str>,
    ) -> Result<WorkspaceRecord, SetWorkspaceDisplayNameError> {
        let normalized = display_name
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);

        if let Some(value) = normalized.as_deref() {
            if value.chars().count() > MAX_WORKSPACE_DISPLAY_NAME_CHARS {
                return Err(SetWorkspaceDisplayNameError::TooLong(
                    MAX_WORKSPACE_DISPLAY_NAME_CHARS,
                ));
            }
        }

        let existing = self
            .store
            .find_by_id(workspace_id)
            .map_err(SetWorkspaceDisplayNameError::Unexpected)?
            .ok_or_else(|| SetWorkspaceDisplayNameError::NotFound(workspace_id.to_string()))?;

        let now = chrono::Utc::now().to_rfc3339();
        self.store
            .update_display_name(workspace_id, normalized.as_deref(), &now)
            .map_err(SetWorkspaceDisplayNameError::Unexpected)?;

        let mut updated = existing;
        updated.display_name = normalized;
        updated.updated_at = now;
        Ok(updated)
    }

    pub fn detect_setup(&self, workspace_id: &str) -> anyhow::Result<ProjectSetupDetectionResult> {
        let record = self
            .store
            .find_by_id(workspace_id)?
            .ok_or_else(|| anyhow::anyhow!("workspace not found: {workspace_id}"))?;
        Ok(detector::detect_project_setup(Path::new(&record.path)))
    }

    pub fn list_workspaces(&self) -> anyhow::Result<Vec<WorkspaceRecord>> {
        self.store.list_execution_surfaces()
    }
}
