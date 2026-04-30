use crate::workspaces::model::WorkspaceRecord;

pub const MAX_MANAGED_WORKSPACES_PER_COWORK_SESSION: usize = 8;
pub const MAX_CODING_SESSIONS_PER_MANAGED_WORKSPACE: usize = 8;

#[derive(Debug, Clone)]
pub struct CodingWorkspaceLaunchOption {
    pub workspace: WorkspaceRecord,
    pub create_block_reason: Option<String>,
}

#[derive(Debug, Clone)]
pub struct CreateCodingWorkspaceInput {
    pub source_workspace_id: String,
    pub label: Option<String>,
}

#[derive(Debug, Clone)]
pub struct CreateCodingSessionInput {
    pub workspace_id: String,
    pub prompt: String,
    pub label: Option<String>,
    pub agent_kind: Option<String>,
    pub model_id: Option<String>,
    pub mode_id: Option<String>,
    pub wake_on_completion: bool,
}

#[derive(Debug, Clone)]
pub struct SendCodingMessageInput {
    pub coding_session_id: String,
    pub prompt: String,
    pub wake_on_completion: bool,
}
