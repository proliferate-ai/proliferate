use anyharness_contract::v1;

use crate::origin::OriginContext;
use crate::sessions::prompt::PromptPayload;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionMcpBindingPolicy {
    InheritWorkspace,
    InternalOnly,
}

impl SessionMcpBindingPolicy {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::InheritWorkspace => "inherit_workspace",
            Self::InternalOnly => "internal_only",
        }
    }

    pub fn parse(value: &str) -> Self {
        match value {
            "internal_only" => Self::InternalOnly,
            "inherit_workspace" => Self::InheritWorkspace,
            other => {
                tracing::warn!(
                    mcp_binding_policy = %other,
                    "unknown MCP binding policy; defaulting to inherit_workspace"
                );
                Self::InheritWorkspace
            }
        }
    }
}

#[derive(Debug, Clone)]
pub struct SessionRecord {
    pub id: String,
    pub workspace_id: String,
    pub agent_kind: String,
    pub native_session_id: Option<String>,
    pub requested_model_id: Option<String>,
    pub current_model_id: Option<String>,
    pub requested_mode_id: Option<String>,
    pub current_mode_id: Option<String>,
    pub title: Option<String>,
    pub thinking_level_id: Option<String>,
    pub thinking_budget_tokens: Option<u32>,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
    pub last_prompt_at: Option<String>,
    pub closed_at: Option<String>,
    pub dismissed_at: Option<String>,
    pub mcp_bindings_ciphertext: Option<String>,
    pub mcp_binding_summaries_json: Option<String>,
    pub mcp_binding_policy: SessionMcpBindingPolicy,
    pub system_prompt_append: Option<String>,
    pub subagents_enabled: bool,
    pub action_capabilities_json: Option<String>,
    pub origin: Option<OriginContext>,
}

impl SessionRecord {
    pub fn to_contract(&self) -> v1::Session {
        self.to_contract_with_details(None, None)
    }

    pub fn to_contract_with_live_config(
        &self,
        live_config: Option<v1::SessionLiveConfigSnapshot>,
    ) -> v1::Session {
        self.to_contract_with_details(live_config, None)
    }

    pub fn to_contract_with_details(
        &self,
        live_config: Option<v1::SessionLiveConfigSnapshot>,
        execution_summary: Option<v1::SessionExecutionSummary>,
    ) -> v1::Session {
        v1::Session {
            id: self.id.clone(),
            workspace_id: self.workspace_id.clone(),
            agent_kind: self.agent_kind.clone(),
            native_session_id: self.native_session_id.clone(),
            model_id: self.current_model_id.clone(),
            requested_model_id: self.requested_model_id.clone(),
            mode_id: self.current_mode_id.clone(),
            requested_mode_id: self.requested_mode_id.clone(),
            title: self.title.clone(),
            live_config,
            execution_summary,
            mcp_binding_summaries: parse_mcp_binding_summaries(
                self.mcp_binding_summaries_json.as_deref(),
            ),
            status: parse_status(&self.status),
            created_at: self.created_at.clone(),
            updated_at: self.updated_at.clone(),
            last_prompt_at: self.last_prompt_at.clone(),
            closed_at: self.closed_at.clone(),
            dismissed_at: self.dismissed_at.clone(),
            pending_prompts: Vec::new(),
            action_capabilities: parse_action_capabilities(
                self.action_capabilities_json.as_deref(),
            ),
            origin: self.origin.as_ref().map(OriginContext::to_contract),
        }
    }
}

pub fn serialize_action_capabilities(
    capabilities: v1::SessionActionCapabilities,
) -> anyhow::Result<String> {
    Ok(serde_json::to_string(&capabilities)?)
}

pub fn parse_action_capabilities(value: Option<&str>) -> v1::SessionActionCapabilities {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return v1::SessionActionCapabilities::default();
    };
    match serde_json::from_str(value) {
        Ok(capabilities) => capabilities,
        Err(error) => {
            tracing::warn!(error = %error, "invalid session action capabilities JSON");
            v1::SessionActionCapabilities::default()
        }
    }
}

fn parse_mcp_binding_summaries(value: Option<&str>) -> Option<Vec<v1::SessionMcpBindingSummary>> {
    let value = value.map(str::trim).filter(|value| !value.is_empty())?;
    match serde_json::from_str(value) {
        Ok(summaries) => Some(summaries),
        Err(error) => {
            tracing::warn!(error = %error, "invalid session MCP binding summaries JSON");
            None
        }
    }
}

impl PendingPromptRecord {
    pub fn to_contract(&self) -> v1::PendingPromptSummary {
        let payload = self.prompt_payload();
        v1::PendingPromptSummary {
            seq: self.seq,
            prompt_id: self.prompt_id.clone(),
            text: self.text.clone(),
            content_parts: payload.content_parts(),
            queued_at: self.queued_at.clone(),
            prompt_provenance: payload.public_provenance(),
        }
    }

    pub fn prompt_payload(&self) -> PromptPayload {
        PromptPayload::from_persisted(
            self.blocks_json.as_deref(),
            &self.text,
            self.provenance_json.as_deref(),
        )
    }

    pub fn attachment_ids(&self) -> Vec<String> {
        self.prompt_payload().attachment_ids()
    }
}

#[derive(Debug, Clone)]
pub struct SessionLiveConfigSnapshotRecord {
    pub session_id: String,
    pub source_seq: i64,
    pub raw_config_options_json: String,
    pub normalized_controls_json: String,
    pub prompt_capabilities_json: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct PendingConfigChangeRecord {
    pub session_id: String,
    pub config_id: String,
    pub value: String,
    pub queued_at: String,
}

#[derive(Debug, Clone)]
pub struct PendingPromptRecord {
    pub session_id: String,
    pub seq: i64,
    pub prompt_id: Option<String>,
    pub text: String,
    pub blocks_json: Option<String>,
    pub provenance_json: Option<String>,
    pub queued_at: String,
}

#[derive(Debug, Clone)]
pub struct PromptAttachmentRecord {
    pub attachment_id: String,
    pub session_id: String,
    pub state: PromptAttachmentState,
    pub kind: PromptAttachmentKind,
    pub source: PromptAttachmentSource,
    pub mime_type: Option<String>,
    pub display_name: Option<String>,
    pub source_uri: Option<String>,
    pub storage_path: String,
    pub size_bytes: i64,
    pub sha256: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PromptAttachmentState {
    Pending,
    Transcript,
    Orphaned,
    Deleted,
}

impl PromptAttachmentState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Transcript => "transcript",
            Self::Orphaned => "orphaned",
            Self::Deleted => "deleted",
        }
    }

    pub fn parse(value: &str) -> Self {
        match value {
            "pending" => Self::Pending,
            "transcript" => Self::Transcript,
            "orphaned" => Self::Orphaned,
            "deleted" => Self::Deleted,
            other => {
                tracing::warn!(
                    attachment_state = %other,
                    "unknown prompt attachment state; defaulting to orphaned"
                );
                Self::Orphaned
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PromptAttachmentSource {
    Upload,
    Paste,
}

impl PromptAttachmentSource {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Upload => "upload",
            Self::Paste => "paste",
        }
    }

    pub fn parse(value: &str) -> Self {
        match value {
            "upload" => Self::Upload,
            "paste" => Self::Paste,
            other => {
                tracing::warn!(
                    attachment_source = %other,
                    "unknown prompt attachment source; defaulting to upload"
                );
                Self::Upload
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PromptAttachmentKind {
    Image,
    TextResource,
}

impl PromptAttachmentKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Image => "image",
            Self::TextResource => "text_resource",
        }
    }

    pub fn parse(value: &str) -> Self {
        match value {
            "image" => Self::Image,
            "text_resource" => Self::TextResource,
            other => {
                tracing::warn!(
                    attachment_kind = %other,
                    "unknown prompt attachment kind; defaulting to text_resource"
                );
                Self::TextResource
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionBackgroundWorkTrackerKind {
    ClaudeAsyncAgent,
}

impl SessionBackgroundWorkTrackerKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ClaudeAsyncAgent => "claude_async_agent",
        }
    }

    pub fn parse(value: &str) -> Self {
        match value {
            "claude_async_agent" => Self::ClaudeAsyncAgent,
            _ => {
                tracing::warn!(
                    tracker_kind = %value,
                    "unknown background work tracker kind; defaulting to claude_async_agent"
                );
                Self::ClaudeAsyncAgent
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionBackgroundWorkState {
    Pending,
    Completed,
    Expired,
}

impl SessionBackgroundWorkState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Completed => "completed",
            Self::Expired => "expired",
        }
    }

    pub fn parse(value: &str) -> Self {
        match value {
            "completed" => Self::Completed,
            "expired" => Self::Expired,
            "pending" => Self::Pending,
            _ => {
                tracing::warn!(
                    background_work_state = %value,
                    "unknown background work state; defaulting to pending"
                );
                Self::Pending
            }
        }
    }
}

#[derive(Debug, Clone)]
pub struct SessionBackgroundWorkRecord {
    pub session_id: String,
    pub tool_call_id: String,
    pub turn_id: String,
    pub tracker_kind: SessionBackgroundWorkTrackerKind,
    pub source_agent_kind: String,
    pub agent_id: Option<String>,
    pub output_file: String,
    pub state: SessionBackgroundWorkState,
    pub created_at: String,
    pub updated_at: String,
    pub launched_at: String,
    pub last_activity_at: String,
    pub completed_at: Option<String>,
}

fn parse_status(s: &str) -> v1::SessionStatus {
    match s {
        "starting" => v1::SessionStatus::Starting,
        "idle" => v1::SessionStatus::Idle,
        "running" => v1::SessionStatus::Running,
        "completed" => v1::SessionStatus::Completed,
        "errored" => v1::SessionStatus::Errored,
        "closed" => v1::SessionStatus::Closed,
        _ => v1::SessionStatus::Errored,
    }
}

#[derive(Debug, Clone)]
pub struct SessionEventRecord {
    pub id: i64,
    pub session_id: String,
    pub seq: i64,
    pub timestamp: String,
    pub event_type: String,
    pub turn_id: Option<String>,
    pub item_id: Option<String>,
    pub payload_json: String,
}

#[derive(Debug, Clone)]
pub struct SessionRawNotificationRecord {
    pub id: i64,
    pub session_id: String,
    pub seq: i64,
    pub timestamp: String,
    pub notification_kind: String,
    pub payload_json: String,
}
