#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SafeStopState {
    Safe,
    Blocked,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SafeStopBlockerCode {
    ActiveSession,
    ActiveTurn,
    PendingInteraction,
    PendingPrompt,
    ActiveTerminal,
    ActiveProcess,
    WorkspaceOperationInProgress,
    RuntimeStateUnavailable,
}

#[derive(Debug, Clone)]
pub struct SafeStopBlocker {
    pub code: SafeStopBlockerCode,
    pub message: String,
    pub count: usize,
    pub workspace_id: Option<String>,
    pub session_id: Option<String>,
    pub terminal_id: Option<String>,
    pub operation: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimeReadinessState {
    Ready,
    InstallRequired,
    CredentialsRequired,
    LoginRequired,
    Unsupported,
    Error,
    Unknown,
}

#[derive(Debug, Clone)]
pub struct RuntimeReadinessEntry {
    pub id: String,
    pub display_name: Option<String>,
    pub state: RuntimeReadinessState,
    pub message: Option<String>,
}

#[derive(Debug, Clone)]
pub struct RuntimeWorkspaceRoot {
    pub path: String,
    pub kind: String,
    pub workspace_count: usize,
}

#[derive(Debug, Clone)]
pub struct RuntimeInventoryCapabilities {
    pub supports_process_spawn: bool,
    pub supports_pty: bool,
    pub supports_filesystem: bool,
    pub supports_git: bool,
    pub supports_network_egress: bool,
    pub supports_port_forwarding: bool,
    pub supports_browser: bool,
    pub supports_computer_use: bool,
    pub supports_docker: bool,
}

#[derive(Debug, Clone)]
pub struct RuntimeToolVersions {
    pub node_version: Option<String>,
    pub npm_version: Option<String>,
    pub python_version: Option<String>,
    pub uv_version: Option<String>,
    pub git_version: Option<String>,
}

#[derive(Debug, Clone)]
pub struct RuntimeInventorySnapshot {
    pub reported_at: String,
    pub runtime_version: String,
    pub runtime_home: String,
    pub os_kind: String,
    pub os_version: Option<String>,
    pub arch: String,
    pub distro: Option<String>,
    pub shell: String,
    pub package_managers: Vec<String>,
    pub workspace_roots: Vec<RuntimeWorkspaceRoot>,
    pub capabilities: RuntimeInventoryCapabilities,
    pub versions: RuntimeToolVersions,
    pub provider_readiness: Vec<RuntimeReadinessEntry>,
    pub mcp_readiness: Vec<RuntimeReadinessEntry>,
    pub agent_catalog_revision: Option<String>,
    pub collection_errors: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct RuntimeOperationCount {
    pub kind: String,
    pub count: usize,
}

#[derive(Debug, Clone)]
pub struct RuntimeActivitySnapshot {
    pub reported_at: String,
    pub workspace_count: usize,
    pub total_session_count: usize,
    pub active_session_count: usize,
    pub active_turn_count: usize,
    pub pending_interaction_count: usize,
    pub pending_prompt_count: usize,
    pub active_terminal_count: usize,
    pub active_process_count: usize,
    pub workspace_operation_count: usize,
    pub operation_counts: Vec<RuntimeOperationCount>,
    pub safe_stop_state: SafeStopState,
    pub safe_stop_reasons: Vec<SafeStopBlocker>,
    pub collection_errors: Vec<String>,
}

#[derive(Debug, Clone, Default)]
pub struct PrepareStopInput {
    pub reason: Option<String>,
    pub workspace_ids: Option<Vec<String>>,
    pub force: Option<bool>,
}

#[derive(Debug, Clone)]
pub struct PrepareStopSnapshot {
    pub prepared_at: String,
    pub safe_stop_state: SafeStopState,
    pub blockers: Vec<SafeStopBlocker>,
    pub activity: RuntimeActivitySnapshot,
    pub message: Option<String>,
}
