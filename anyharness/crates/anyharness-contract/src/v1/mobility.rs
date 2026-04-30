use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::{ContentPart, OriginContext};

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceMobilityRuntimeMode {
    Normal,
    FrozenForHandoff,
    RemoteOwned,
    RepairBlocked,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceMobilityRuntimeState {
    pub workspace_id: String,
    pub mode: WorkspaceMobilityRuntimeMode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub handoff_op_id: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateWorkspaceMobilityRuntimeStateRequest {
    pub mode: WorkspaceMobilityRuntimeMode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub handoff_op_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceMobilityBlocker {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceMobilitySessionCandidate {
    pub session_id: String,
    pub agent_kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_session_id: Option<String>,
    pub supported: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceMobilityPreflightResponse {
    pub workspace_id: String,
    pub can_move: bool,
    pub runtime_state: WorkspaceMobilityRuntimeState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_commit_sha: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub archive_estimated_bytes: Option<u64>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub blockers: Vec<WorkspaceMobilityBlocker>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sessions: Vec<WorkspaceMobilitySessionCandidate>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExportWorkspaceMobilityArchiveRequest {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub exclude_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct InstallWorkspaceMobilityArchiveRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub operation_id: Option<String>,
    pub archive: WorkspaceMobilityArchive,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct InstallWorkspaceMobilityArchiveResponse {
    pub workspace_id: String,
    pub source_workspace_path: String,
    pub base_commit_sha: String,
    pub imported_session_ids: Vec<String>,
    pub applied_file_count: usize,
    pub deleted_file_count: usize,
    pub imported_agent_artifact_count: usize,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DestroyWorkspaceMobilitySourceRequest {}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DestroyWorkspaceMobilitySourceResponse {
    pub workspace_id: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub deleted_session_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub closed_terminal_ids: Vec<String>,
    pub source_destroyed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceMobilityArchive {
    pub source_workspace_path: String,
    pub repo_root_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch_name: Option<String>,
    pub base_commit_sha: String,
    pub files: Vec<WorkspaceMobilityFileEntry>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub deleted_paths: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sessions: Vec<WorkspaceMobilitySessionBundle>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub session_links: Vec<MobilitySessionLinkRecord>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub session_link_completions: Vec<MobilitySessionLinkCompletionRecord>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub session_link_wake_schedules: Vec<MobilitySessionLinkWakeScheduleRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceMobilityFileEntry {
    pub relative_path: String,
    pub mode: u32,
    #[schema(value_type = String, format = Binary)]
    pub content_base64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceMobilitySessionBundle {
    pub session: MobilitySessionRecord,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub live_config_snapshot: Option<MobilitySessionLiveConfigSnapshotRecord>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub pending_config_changes: Vec<MobilityPendingConfigChangeRecord>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub pending_prompts: Vec<MobilityPendingPromptRecord>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub prompt_attachments: Vec<MobilityPromptAttachmentRecord>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub events: Vec<MobilitySessionEventRecord>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub raw_notifications: Vec<MobilitySessionRawNotificationRecord>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub agent_artifacts: Vec<WorkspaceMobilityFileEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MobilitySessionRecord {
    pub id: String,
    pub agent_kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub requested_model_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_model_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub requested_mode_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_mode_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thinking_level_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thinking_budget_tokens: Option<u32>,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_prompt_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub closed_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dismissed_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system_prompt_append: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin: Option<OriginContext>,
    #[serde(default = "default_true")]
    pub subagents_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MobilitySessionLinkRecord {
    pub id: String,
    pub relation: String,
    pub parent_session_id: String,
    pub child_session_id: String,
    pub workspace_relation: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_by_turn_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_by_tool_call_id: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MobilitySessionLinkCompletionRecord {
    pub completion_id: String,
    pub session_link_id: String,
    pub child_turn_id: String,
    pub child_last_event_seq: i64,
    pub outcome: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_event_seq: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_prompt_seq: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MobilitySessionLinkWakeScheduleRecord {
    pub session_link_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MobilitySessionLiveConfigSnapshotRecord {
    pub session_id: String,
    pub source_seq: i64,
    pub raw_config_options_json: String,
    pub normalized_controls_json: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt_capabilities_json: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MobilityPendingConfigChangeRecord {
    pub session_id: String,
    pub config_id: String,
    pub value: String,
    pub queued_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MobilityPendingPromptRecord {
    pub session_id: String,
    pub seq: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt_id: Option<String>,
    pub text: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub content_parts: Vec<ContentPart>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blocks_json: Option<String>,
    pub queued_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MobilityPromptAttachmentRecord {
    pub attachment_id: String,
    pub session_id: String,
    pub state: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_uri: Option<String>,
    pub size_bytes: u64,
    pub sha256: String,
    #[schema(value_type = String, format = Binary)]
    pub content_base64: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MobilitySessionEventRecord {
    pub session_id: String,
    pub seq: i64,
    pub timestamp: String,
    pub event_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub item_id: Option<String>,
    pub payload_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MobilitySessionRawNotificationRecord {
    pub session_id: String,
    pub seq: i64,
    pub timestamp: String,
    pub notification_kind: String,
    pub payload_json: String,
}
