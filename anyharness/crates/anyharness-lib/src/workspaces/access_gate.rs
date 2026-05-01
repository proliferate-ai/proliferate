use std::sync::Arc;

use super::access_model::{WorkspaceAccessMode, WorkspaceAccessRecord};
use super::access_store::WorkspaceAccessStore;
use super::store::WorkspaceStore;
use crate::sessions::store::SessionStore;
use crate::terminals::service::TerminalService;

#[derive(Debug, thiserror::Error)]
pub enum WorkspaceAccessError {
    #[error("workspace not found: {0}")]
    WorkspaceNotFound(String),
    #[error("session not found: {0}")]
    SessionNotFound(String),
    #[error("terminal not found: {0}")]
    TerminalNotFound(String),
    #[error("workspace {workspace_id} is not writable while mode={mode}")]
    MutationBlocked {
        workspace_id: String,
        mode: WorkspaceAccessMode,
    },
    #[error("workspace {workspace_id} cannot start live sessions while mode={mode}")]
    LiveSessionStartBlocked {
        workspace_id: String,
        mode: WorkspaceAccessMode,
    },
    #[error("workspace {0} is retired")]
    WorkspaceRetired(String),
}

#[derive(Clone)]
pub struct WorkspaceAccessGate {
    workspace_store: WorkspaceStore,
    session_store: SessionStore,
    access_store: WorkspaceAccessStore,
    terminal_service: Arc<TerminalService>,
}

impl WorkspaceAccessGate {
    pub fn new(
        workspace_store: WorkspaceStore,
        session_store: SessionStore,
        access_store: WorkspaceAccessStore,
        terminal_service: Arc<TerminalService>,
    ) -> Self {
        Self {
            workspace_store,
            session_store,
            access_store,
            terminal_service,
        }
    }

    pub fn runtime_state(
        &self,
        workspace_id: &str,
    ) -> Result<WorkspaceAccessRecord, WorkspaceAccessError> {
        let workspace = self
            .workspace_store
            .find_by_id(workspace_id)
            .map_err(|error| WorkspaceAccessError::WorkspaceNotFound(error.to_string()))?
            .ok_or_else(|| WorkspaceAccessError::WorkspaceNotFound(workspace_id.to_string()))?;
        Ok(self
            .access_store
            .find_by_workspace(workspace_id)
            .map_err(|error| WorkspaceAccessError::WorkspaceNotFound(error.to_string()))?
            .unwrap_or_else(|| WorkspaceAccessRecord::normal_for_workspace(&workspace)))
    }

    pub fn set_runtime_state(
        &self,
        workspace_id: &str,
        mode: WorkspaceAccessMode,
        handoff_op_id: Option<String>,
    ) -> Result<WorkspaceAccessRecord, WorkspaceAccessError> {
        let workspace = self
            .workspace_store
            .find_by_id(workspace_id)
            .map_err(|error| WorkspaceAccessError::WorkspaceNotFound(error.to_string()))?
            .ok_or_else(|| WorkspaceAccessError::WorkspaceNotFound(workspace_id.to_string()))?;
        let record = WorkspaceAccessRecord {
            workspace_id: workspace.id.clone(),
            mode,
            handoff_op_id,
            updated_at: chrono::Utc::now().to_rfc3339(),
        };
        self.access_store
            .upsert(&record)
            .map_err(|error| WorkspaceAccessError::WorkspaceNotFound(error.to_string()))?;
        Ok(record)
    }

    pub fn clear_runtime_state(&self, workspace_id: &str) -> Result<(), WorkspaceAccessError> {
        self.access_store
            .delete(workspace_id)
            .map_err(|error| WorkspaceAccessError::WorkspaceNotFound(error.to_string()))
    }

    pub fn assert_can_mutate_for_workspace(
        &self,
        workspace_id: &str,
    ) -> Result<(), WorkspaceAccessError> {
        let workspace = self
            .workspace_store
            .find_by_id(workspace_id)
            .map_err(|error| WorkspaceAccessError::WorkspaceNotFound(error.to_string()))?
            .ok_or_else(|| WorkspaceAccessError::WorkspaceNotFound(workspace_id.to_string()))?;
        if workspace.lifecycle_state == "retired" {
            return Err(WorkspaceAccessError::WorkspaceRetired(
                workspace_id.to_string(),
            ));
        }
        let state = self.runtime_state(workspace_id)?;
        match state.mode {
            WorkspaceAccessMode::Normal => Ok(()),
            mode => Err(WorkspaceAccessError::MutationBlocked {
                workspace_id: workspace_id.to_string(),
                mode,
            }),
        }
    }

    pub fn assert_can_mutate_for_repo_root(
        &self,
        repo_root_id: &str,
    ) -> Result<(), WorkspaceAccessError> {
        let workspaces = self
            .workspace_store
            .list_active_by_repo_root_id(repo_root_id)
            .map_err(|error| WorkspaceAccessError::WorkspaceNotFound(error.to_string()))?;
        for workspace in workspaces {
            self.assert_can_mutate_for_workspace(&workspace.id)?;
        }
        Ok(())
    }

    pub fn assert_can_prepare_mobility_destination_for_repo_root(
        &self,
        repo_root_id: &str,
    ) -> Result<(), WorkspaceAccessError> {
        let workspaces = self
            .workspace_store
            .list_active_by_repo_root_id(repo_root_id)
            .map_err(|error| WorkspaceAccessError::WorkspaceNotFound(error.to_string()))?;
        for workspace in workspaces {
            let state = self.runtime_state(&workspace.id)?;
            if matches!(
                state.mode,
                WorkspaceAccessMode::FrozenForHandoff | WorkspaceAccessMode::RepairBlocked
            ) {
                return Err(WorkspaceAccessError::MutationBlocked {
                    workspace_id: workspace.id,
                    mode: state.mode,
                });
            }
        }
        Ok(())
    }

    pub fn assert_can_mutate_for_session(
        &self,
        session_id: &str,
    ) -> Result<(), WorkspaceAccessError> {
        let session = self
            .session_store
            .find_by_id(session_id)
            .map_err(|error| WorkspaceAccessError::SessionNotFound(error.to_string()))?
            .ok_or_else(|| WorkspaceAccessError::SessionNotFound(session_id.to_string()))?;
        self.assert_can_mutate_for_workspace(&session.workspace_id)
    }

    pub async fn assert_can_mutate_for_terminal(
        &self,
        terminal_id: &str,
    ) -> Result<(), WorkspaceAccessError> {
        let terminal = self
            .terminal_service
            .get_terminal(terminal_id)
            .await
            .ok_or_else(|| WorkspaceAccessError::TerminalNotFound(terminal_id.to_string()))?;
        self.assert_can_mutate_for_workspace(&terminal.workspace_id)
    }

    pub fn assert_can_start_live_session(
        &self,
        session_id: &str,
    ) -> Result<(), WorkspaceAccessError> {
        let session = self
            .session_store
            .find_by_id(session_id)
            .map_err(|error| WorkspaceAccessError::SessionNotFound(error.to_string()))?
            .ok_or_else(|| WorkspaceAccessError::SessionNotFound(session_id.to_string()))?;
        let state = self.runtime_state(&session.workspace_id)?;
        let workspace = self
            .workspace_store
            .find_by_id(&session.workspace_id)
            .map_err(|error| WorkspaceAccessError::WorkspaceNotFound(error.to_string()))?
            .ok_or_else(|| WorkspaceAccessError::WorkspaceNotFound(session.workspace_id.clone()))?;
        if workspace.lifecycle_state == "retired" {
            return Err(WorkspaceAccessError::WorkspaceRetired(session.workspace_id));
        }
        match state.mode {
            WorkspaceAccessMode::Normal => Ok(()),
            mode => Err(WorkspaceAccessError::LiveSessionStartBlocked {
                workspace_id: session.workspace_id,
                mode,
            }),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::WorkspaceAccessGate;
    use crate::persistence::Db;
    use crate::sessions::store::SessionStore;
    use crate::terminals::service::TerminalService;
    use crate::terminals::store::TerminalStore;
    use crate::workspaces::access_model::{WorkspaceAccessMode, WorkspaceAccessRecord};
    use crate::workspaces::access_store::WorkspaceAccessStore;
    use crate::workspaces::model::WorkspaceRecord;
    use crate::workspaces::store::WorkspaceStore;

    fn workspace_record(id: &str, repo_root_id: &str, path: &str) -> WorkspaceRecord {
        WorkspaceRecord {
            id: id.to_string(),
            kind: "worktree".to_string(),
            repo_root_id: Some(repo_root_id.to_string()),
            path: path.to_string(),
            surface: "standard".to_string(),
            source_repo_root_path: "/tmp/repo".to_string(),
            source_workspace_id: Some(repo_root_id.to_string()),
            git_provider: None,
            git_owner: None,
            git_repo_name: None,
            original_branch: Some("main".to_string()),
            current_branch: Some("main".to_string()),
            display_name: None,
            origin: None,
            creator_context: None,
            lifecycle_state: "active".to_string(),
            cleanup_state: "none".to_string(),
            cleanup_operation: None,
            cleanup_error_message: None,
            cleanup_failed_at: None,
            cleanup_attempted_at: None,
            created_at: "2025-01-01T00:00:00Z".to_string(),
            updated_at: "2025-01-01T00:00:00Z".to_string(),
        }
    }

    fn access_record(workspace_id: &str, mode: WorkspaceAccessMode) -> WorkspaceAccessRecord {
        WorkspaceAccessRecord {
            workspace_id: workspace_id.to_string(),
            mode,
            handoff_op_id: Some("handoff-1".to_string()),
            updated_at: "2025-01-01T00:00:00Z".to_string(),
        }
    }

    fn build_gate() -> (WorkspaceAccessGate, WorkspaceStore, WorkspaceAccessStore) {
        let db = Db::open_in_memory().expect("open db");
        let workspace_store = WorkspaceStore::new(db.clone());
        let session_store = SessionStore::new(db.clone());
        let access_store = WorkspaceAccessStore::new(db.clone());
        let runtime_home = std::env::temp_dir().join(format!(
            "anyharness-access-gate-test-{}",
            uuid::Uuid::new_v4()
        ));
        let gate = WorkspaceAccessGate::new(
            workspace_store.clone(),
            session_store,
            access_store.clone(),
            Arc::new(TerminalService::new(TerminalStore::new(db), runtime_home)),
        );
        (gate, workspace_store, access_store)
    }

    #[test]
    fn mobility_destination_prepare_allows_remote_owned_repo_root_members() {
        let (gate, workspace_store, access_store) = build_gate();
        workspace_store
            .insert(&workspace_record(
                "workspace-1",
                "repo-root-1",
                "/tmp/repo/one",
            ))
            .expect("insert workspace");
        access_store
            .upsert(&access_record(
                "workspace-1",
                WorkspaceAccessMode::RemoteOwned,
            ))
            .expect("set state");

        gate.assert_can_prepare_mobility_destination_for_repo_root("repo-root-1")
            .expect("remote owned workspace should not block destination prep");
    }

    #[test]
    fn mobility_destination_prepare_blocks_frozen_repo_root_members() {
        let (gate, workspace_store, access_store) = build_gate();
        workspace_store
            .insert(&workspace_record(
                "workspace-1",
                "repo-root-1",
                "/tmp/repo/one",
            ))
            .expect("insert workspace");
        access_store
            .upsert(&access_record(
                "workspace-1",
                WorkspaceAccessMode::FrozenForHandoff,
            ))
            .expect("set state");

        let error = gate
            .assert_can_prepare_mobility_destination_for_repo_root("repo-root-1")
            .expect_err("frozen workspace should block destination prep");
        let message = error.to_string();
        assert!(message.contains("workspace workspace-1 is not writable"));
        assert!(message.contains("frozen_for_handoff"));
    }

    #[test]
    fn mobility_destination_prepare_blocks_repair_blocked_repo_root_members() {
        let (gate, workspace_store, access_store) = build_gate();
        workspace_store
            .insert(&workspace_record(
                "workspace-1",
                "repo-root-1",
                "/tmp/repo/one",
            ))
            .expect("insert workspace");
        access_store
            .upsert(&access_record(
                "workspace-1",
                WorkspaceAccessMode::RepairBlocked,
            ))
            .expect("set state");

        let error = gate
            .assert_can_prepare_mobility_destination_for_repo_root("repo-root-1")
            .expect_err("repair-blocked workspace should block destination prep");
        let message = error.to_string();
        assert!(message.contains("workspace workspace-1 is not writable"));
        assert!(message.contains("repair_blocked"));
    }
}
