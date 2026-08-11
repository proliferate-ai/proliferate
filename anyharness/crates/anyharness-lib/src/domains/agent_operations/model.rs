use serde::{Deserialize, Serialize};

pub const DEFAULT_AGENT_PAGE_SIZE: usize = 50;
pub const MAX_AGENT_PAGE_SIZE: usize = 100;

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
    pub const ALL: [Self; 18] = [
        Self::Whoami,
        Self::ListWorkspaces,
        Self::ListWorkspaceOptions,
        Self::CreateWorkspace,
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
