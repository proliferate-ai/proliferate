use serde::{Deserialize, Serialize};

use crate::domains::agents::model::ModelCatalogStatus;
use crate::domains::workspaces::creator_context::WorkspaceCreatorContext;
use crate::domains::workspaces::options::{WorkspaceCreationMode, WorkspaceCreationOptions};
use crate::origin::OriginContext;

pub const DEFAULT_AGENT_PAGE_SIZE: usize = 50;
pub const MAX_AGENT_PAGE_SIZE: usize = 100;
pub const DEFAULT_WORKSPACE_PAGE_SIZE: usize = 50;
pub const MAX_WORKSPACE_PAGE_SIZE: usize = 100;

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize)]
#[serde(transparent)]
pub struct RuntimeIdentity(String);

impl RuntimeIdentity {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentIdentity {
    pub runtime_id: RuntimeIdentity,
    pub session_id: String,
}

impl AgentIdentity {
    pub fn new(runtime_id: RuntimeIdentity, session_id: impl Into<String>) -> Self {
        Self {
            runtime_id,
            session_id: session_id.into(),
        }
    }
}

/// Identity admitted by an authenticated edge. Tool arguments never construct
/// or override this value.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthenticatedAgentCaller {
    identity: AgentIdentity,
}

impl AuthenticatedAgentCaller {
    pub fn new(runtime_id: RuntimeIdentity, session_id: impl Into<String>) -> Self {
        Self {
            identity: AgentIdentity::new(runtime_id, session_id),
        }
    }

    pub fn identity(&self) -> &AgentIdentity {
        &self.identity
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceIdentity {
    pub runtime_id: RuntimeIdentity,
    pub workspace_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentRole {
    Ordinary,
    Subagent,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentPresentationStatus {
    Running,
    Available,
    Closed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentExecutionStatus {
    Starting,
    Running,
    AwaitingInteraction,
    Idle,
    Errored,
    Closed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectiveAgentStatus {
    pub presentation: AgentPresentationStatus,
    pub execution: AgentExecutionStatus,
    pub has_live_actor: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentCapability {
    Whoami,
    ListWorkspaces,
    ListWorkspaceOptions,
    CreateWorkspace,
    PinWorkspace,
    UnpinWorkspace,
    ListAgents,
    GetAgent,
    ListSubagents,
    ListAgentLaunchOptions,
    ListAgentConfigOptions,
    GetTaskOutput,
    CreateAgent,
    ConfigureAgent,
    ResumeAgent,
    SendMessage,
    InterruptAgent,
    CloseSubagent,
    OpenSubagent,
    PromoteSubagent,
}

impl AgentCapability {
    pub const ALL: [Self; 20] = [
        Self::Whoami,
        Self::ListWorkspaces,
        Self::ListWorkspaceOptions,
        Self::CreateWorkspace,
        Self::PinWorkspace,
        Self::UnpinWorkspace,
        Self::ListAgents,
        Self::GetAgent,
        Self::ListSubagents,
        Self::ListAgentLaunchOptions,
        Self::ListAgentConfigOptions,
        Self::GetTaskOutput,
        Self::CreateAgent,
        Self::ConfigureAgent,
        Self::ResumeAgent,
        Self::SendMessage,
        Self::InterruptAgent,
        Self::CloseSubagent,
        Self::OpenSubagent,
        Self::PromoteSubagent,
    ];
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentCreationKind {
    Ordinary,
    Subagent,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityDenial {
    CallerClosed,
    SubagentCannotCreateAgent,
    SubagentSameWorkspaceRequired,
    ParentOnly,
    TargetMustBeSubagent,
    SubagentOpenRequired,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityDecision {
    pub capability: AgentCapability,
    pub allowed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub denial: Option<CapabilityDenial>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentConfiguration {
    pub agent_kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentView {
    pub identity: AgentIdentity,
    pub workspace: WorkspaceIdentity,
    pub role: AgentRole,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent: Option<AgentIdentity>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub configuration: AgentConfiguration,
    pub status: EffectiveAgentStatus,
    pub capabilities: Vec<AgentCapability>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WhoAmIView {
    pub agent: AgentView,
    pub effective_capabilities: Vec<AgentCapability>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ListAgentsInput {
    pub workspace_id: Option<String>,
    pub status: Option<AgentPresentationStatus>,
    pub cursor: Option<String>,
    pub limit: usize,
}

impl Default for ListAgentsInput {
    fn default() -> Self {
        Self {
            workspace_id: None,
            status: None,
            cursor: None,
            limit: DEFAULT_AGENT_PAGE_SIZE,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPage {
    pub agents: Vec<AgentView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CreateAgentInput {
    pub workspace: WorkspaceIdentity,
    pub kind: AgentCreationKind,
    pub task: Option<String>,
    pub agent_kind: Option<String>,
    pub model_id: Option<String>,
    pub mode_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfigureAgentInput {
    pub target: AgentIdentity,
    pub config_id: String,
    pub value: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentConfigApplyState {
    Applied,
    Queued,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigureAgentResult {
    pub agent: AgentView,
    pub apply_state: AgentConfigApplyState,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SendMessageInput {
    pub target: AgentIdentity,
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SendMessageStatus {
    DurablyQueued,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SendMessageReceipt {
    pub target: AgentIdentity,
    pub queue_seq: i64,
    pub status: SendMessageStatus,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ListWorkspacesInput {
    pub cursor: Option<String>,
    pub limit: usize,
}

impl Default for ListWorkspacesInput {
    fn default() -> Self {
        Self {
            cursor: None,
            limit: DEFAULT_WORKSPACE_PAGE_SIZE,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceView {
    pub identity: WorkspaceIdentity,
    pub repository_id: String,
    pub kind: String,
    pub surface: String,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_branch: Option<String>,
    pub lifecycle_state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin: Option<OriginContext>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub creator_context: Option<WorkspaceCreatorContext>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePage {
    pub workspaces: Vec<WorkspaceView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceOptionsView {
    pub runtime_id: RuntimeIdentity,
    #[serde(flatten)]
    pub options: WorkspaceCreationOptions,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CreateWorkspaceInput {
    pub repository_id: String,
    pub creation_mode: String,
    pub branch: Option<String>,
    pub display_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateWorkspaceResult {
    pub workspace: WorkspaceView,
    pub creation_mode: WorkspaceCreationMode,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct WorkspacePinIntent {
    pub request_id: String,
    pub runtime_id: String,
    pub source_session_id: String,
    pub workspace_id: String,
    pub pinned: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkspacePinRequestStatus {
    Requested,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePinRequestResult {
    pub request_id: String,
    pub workspace: WorkspaceView,
    pub pinned: bool,
    pub status: WorkspacePinRequestStatus,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentLaunchModelOption {
    pub id: String,
    pub display_name: String,
    pub aliases: Vec<String>,
    pub is_default: bool,
    pub executable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unavailable_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub status: ModelCatalogStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub effort_values: Option<Vec<String>>,
    pub fast_mode: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modes: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentLaunchOption {
    pub agent_kind: String,
    pub display_name: String,
    pub executable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unavailable_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_model_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unattended_mode_id: Option<String>,
    pub models: Vec<AgentLaunchModelOption>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentLaunchOptionsView {
    pub workspace: WorkspaceIdentity,
    pub catalog_version: String,
    pub agents: Vec<AgentLaunchOption>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedAgentLaunchSelection {
    pub agent_kind: String,
    pub model_id: Option<String>,
    pub mode_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum AgentLaunchSelectionError {
    #[error("agent kind is not in the effective launch options")]
    AgentUnknown,
    #[error("agent kind is currently unavailable")]
    AgentUnavailable,
    #[error("model is not in the effective launch options")]
    ModelUnknown,
    #[error("model is currently unavailable")]
    ModelUnavailable,
    #[error("mode is not in the effective launch options")]
    ModeUnknown,
}

impl AgentLaunchOptionsView {
    pub fn validate_selection(
        &self,
        agent_kind: &str,
        model_id: Option<&str>,
        mode_id: Option<&str>,
    ) -> Result<ValidatedAgentLaunchSelection, AgentLaunchSelectionError> {
        let agent = self
            .agents
            .iter()
            .find(|agent| agent.agent_kind == agent_kind)
            .ok_or(AgentLaunchSelectionError::AgentUnknown)?;
        if !agent.executable {
            return Err(AgentLaunchSelectionError::AgentUnavailable);
        }
        let selected_model = match model_id {
            Some(model_id) => {
                let model = agent
                    .models
                    .iter()
                    .find(|model| {
                        model.id == model_id || model.aliases.iter().any(|alias| alias == model_id)
                    })
                    .ok_or(AgentLaunchSelectionError::ModelUnknown)?;
                if !model.executable {
                    return Err(AgentLaunchSelectionError::ModelUnavailable);
                }
                Some(model)
            }
            None => None,
        };
        if let Some(mode_id) = mode_id {
            let model_supports_mode = |model: &AgentLaunchModelOption| {
                model
                    .modes
                    .as_ref()
                    .is_some_and(|modes| modes.iter().any(|mode| mode == mode_id))
            };
            let effective_model = selected_model.or_else(|| {
                agent.default_model_id.as_deref().and_then(|default_id| {
                    agent.models.iter().find(|model| {
                        model.executable
                            && (model.id == default_id
                                || model.aliases.iter().any(|alias| alias == default_id))
                    })
                })
            });
            let mode_is_listed = match effective_model {
                Some(model) => model_supports_mode(model),
                None => false,
            };
            if !mode_is_listed {
                return Err(AgentLaunchSelectionError::ModeUnknown);
            }
        }
        Ok(ValidatedAgentLaunchSelection {
            agent_kind: agent.agent_kind.clone(),
            model_id: selected_model.map(|model| model.id.clone()),
            mode_id: mode_id.map(str::to_string),
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentConfigValueOption {
    pub value: String,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub executable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unavailable_reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentConfigOption {
    pub key: String,
    pub config_id: String,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_value: Option<String>,
    pub executable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unavailable_reason: Option<String>,
    pub values: Vec<AgentConfigValueOption>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentConfigOptionsView {
    pub agent: AgentIdentity,
    pub workspace: WorkspaceIdentity,
    pub catalog_version: String,
    pub live_snapshot_available: bool,
    pub options: Vec<AgentConfigOption>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedAgentConfigChoice {
    pub config_id: String,
    pub value: String,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum AgentConfigChoiceError {
    #[error("configuration option is not in the effective live vocabulary")]
    ConfigUnknown,
    #[error("configuration option is currently unavailable")]
    ConfigUnavailable,
    #[error("configuration value is not in the effective live vocabulary")]
    ValueUnknown,
    #[error("configuration value is currently unavailable")]
    ValueUnavailable,
}

impl AgentConfigOptionsView {
    pub fn validate_choice(
        &self,
        config_id: &str,
        value: &str,
    ) -> Result<ValidatedAgentConfigChoice, AgentConfigChoiceError> {
        let option = self
            .options
            .iter()
            .find(|option| option.config_id == config_id)
            .ok_or(AgentConfigChoiceError::ConfigUnknown)?;
        if !option.executable {
            return Err(AgentConfigChoiceError::ConfigUnavailable);
        }
        let value = option
            .values
            .iter()
            .find(|candidate| candidate.value == value)
            .ok_or(AgentConfigChoiceError::ValueUnknown)?;
        if !value.executable {
            return Err(AgentConfigChoiceError::ValueUnavailable);
        }
        Ok(ValidatedAgentConfigChoice {
            config_id: option.config_id.clone(),
            value: value.value.clone(),
        })
    }
}
