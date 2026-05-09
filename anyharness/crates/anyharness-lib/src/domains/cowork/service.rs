use super::model::{CoworkManagedWorkspaceRecord, CoworkRootRecord, CoworkThreadRecord};
use super::store::CoworkStore;
use crate::sessions::links::model::SessionLinkRecord;

#[derive(Clone)]
pub struct CoworkService {
    store: CoworkStore,
}

impl CoworkService {
    pub fn new(store: CoworkStore) -> Self {
        Self { store }
    }

    pub fn get_root(&self) -> anyhow::Result<Option<CoworkRootRecord>> {
        self.store.get_root()
    }

    pub fn upsert_root(&self, repo_root_id: &str) -> anyhow::Result<CoworkRootRecord> {
        let existing = self.store.get_root()?;
        let now = chrono::Utc::now().to_rfc3339();
        let record = CoworkRootRecord {
            id: "cowork-root".to_string(),
            repo_root_id: repo_root_id.to_string(),
            created_at: existing
                .as_ref()
                .map(|value| value.created_at.clone())
                .unwrap_or_else(|| now.clone()),
            updated_at: now,
        };
        self.store.upsert_root(&record)?;
        Ok(record)
    }

    pub fn create_thread(&self, record: CoworkThreadRecord) -> anyhow::Result<CoworkThreadRecord> {
        self.store.insert_thread(&record)?;
        Ok(record)
    }

    pub fn list_threads(&self) -> anyhow::Result<Vec<CoworkThreadRecord>> {
        self.store.list_threads()
    }

    pub fn find_thread_by_session(
        &self,
        session_id: &str,
    ) -> anyhow::Result<Option<CoworkThreadRecord>> {
        self.store.find_thread_by_session(session_id)
    }

    pub fn find_managed_workspace_by_workspace(
        &self,
        workspace_id: &str,
    ) -> anyhow::Result<Option<CoworkManagedWorkspaceRecord>> {
        self.store.find_managed_workspace_by_workspace(workspace_id)
    }

    pub fn find_managed_workspace(
        &self,
        parent_session_id: &str,
        workspace_id: &str,
    ) -> anyhow::Result<Option<CoworkManagedWorkspaceRecord>> {
        self.store
            .find_managed_workspace(parent_session_id, workspace_id)
    }

    pub fn list_managed_workspaces(
        &self,
        parent_session_id: &str,
    ) -> anyhow::Result<Vec<CoworkManagedWorkspaceRecord>> {
        self.store.list_managed_workspaces(parent_session_id)
    }

    pub fn insert_managed_workspace_with_limit(
        &self,
        record: &CoworkManagedWorkspaceRecord,
        max_workspaces: usize,
    ) -> anyhow::Result<bool> {
        self.store
            .insert_managed_workspace_with_limit(record, max_workspaces)
    }

    pub fn delete_managed_workspace(&self, id: &str) -> anyhow::Result<()> {
        self.store.delete_managed_workspace(id)
    }

    pub fn insert_coding_session_link_with_workspace_limit(
        &self,
        record: &SessionLinkRecord,
        workspace_id: &str,
        max_sessions_per_workspace: usize,
    ) -> anyhow::Result<bool> {
        self.store.insert_coding_session_link_with_workspace_limit(
            record,
            workspace_id,
            max_sessions_per_workspace,
        )
    }
}
