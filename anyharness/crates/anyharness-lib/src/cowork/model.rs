#[derive(Debug, Clone)]
pub struct CoworkRootRecord {
    pub id: String,
    pub repo_root_id: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct CoworkThreadRecord {
    pub id: String,
    pub repo_root_id: String,
    pub workspace_id: String,
    pub session_id: String,
    pub agent_kind: String,
    pub requested_model_id: Option<String>,
    pub branch_name: String,
    pub workspace_delegation_enabled: bool,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct CoworkManagedWorkspaceRecord {
    pub id: String,
    pub parent_session_id: String,
    pub workspace_id: String,
    pub source_workspace_id: Option<String>,
    pub label: Option<String>,
    pub created_at: String,
}
