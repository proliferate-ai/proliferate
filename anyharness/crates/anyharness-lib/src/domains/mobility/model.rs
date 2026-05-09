use crate::sessions::links::model::SessionLinkRecord;
use crate::sessions::model::{
    PendingConfigChangeRecord, PendingPromptRecord, PromptAttachmentRecord, SessionEventRecord,
    SessionLiveConfigSnapshotRecord, SessionRawNotificationRecord, SessionRecord,
};
use crate::sessions::subagents::model::{SubagentCompletionRecord, SubagentWakeScheduleRecord};
use crate::workspaces::access_model::WorkspaceAccessRecord;

pub const MAX_MOBILITY_ARCHIVE_BODY_BYTES: usize = 128 * 1024 * 1024;
pub const MAX_MOBILITY_FILE_BYTES: usize = 16 * 1024 * 1024;

#[derive(Debug, Clone)]
pub struct MobilityFileData {
    pub relative_path: String,
    pub mode: u32,
    pub content: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct WorkspaceMobilityArchiveData {
    pub source_workspace_path: String,
    pub repo_root_path: String,
    pub branch_name: Option<String>,
    pub base_commit_sha: String,
    pub files: Vec<MobilityFileData>,
    pub deleted_paths: Vec<String>,
    pub sessions: Vec<WorkspaceMobilitySessionBundleData>,
    pub session_links: Vec<SessionLinkRecord>,
    pub session_link_completions: Vec<SubagentCompletionRecord>,
    pub session_link_wake_schedules: Vec<SubagentWakeScheduleRecord>,
}

#[derive(Debug, Clone)]
pub struct WorkspaceMobilitySessionBundleData {
    pub session: SessionRecord,
    pub live_config_snapshot: Option<SessionLiveConfigSnapshotRecord>,
    pub pending_config_changes: Vec<PendingConfigChangeRecord>,
    pub pending_prompts: Vec<PendingPromptRecord>,
    pub prompt_attachments: Vec<MobilityPromptAttachmentData>,
    pub events: Vec<SessionEventRecord>,
    pub raw_notifications: Vec<SessionRawNotificationRecord>,
    pub agent_artifacts: Vec<MobilityFileData>,
}

#[derive(Debug, Clone)]
pub struct MobilityPromptAttachmentData {
    pub record: PromptAttachmentRecord,
    pub content: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct ImportedWorkspaceArchiveSummary {
    pub workspace_id: String,
    pub source_workspace_path: String,
    pub base_commit_sha: String,
    pub imported_session_ids: Vec<String>,
    pub applied_file_count: usize,
    pub deleted_file_count: usize,
    pub imported_agent_artifact_count: usize,
}

#[derive(Debug, Clone)]
pub struct DestroyedWorkspaceSourceSummary {
    pub workspace_id: String,
    pub deleted_session_ids: Vec<String>,
    pub closed_terminal_ids: Vec<String>,
    pub source_destroyed: bool,
}

#[derive(Debug, Clone)]
pub struct MobilityBlocker {
    pub code: String,
    pub message: String,
    pub session_id: Option<String>,
}

#[derive(Debug, Clone)]
pub struct MobilitySessionCandidate {
    pub session: SessionRecord,
    pub supported: bool,
    pub reason: Option<String>,
}

#[derive(Debug, Clone)]
pub struct WorkspaceMobilityPreflightResult {
    pub workspace_id: String,
    pub runtime_state: WorkspaceAccessRecord,
    pub can_move: bool,
    pub branch_name: Option<String>,
    pub base_commit_sha: Option<String>,
    pub archive_estimated_bytes: Option<u64>,
    pub blockers: Vec<MobilityBlocker>,
    pub sessions: Vec<MobilitySessionCandidate>,
    pub warnings: Vec<String>,
}
