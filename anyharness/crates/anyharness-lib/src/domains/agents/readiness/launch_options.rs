//! The derived launch-options view: which agents a session can launch and
//! which models their menus show. The shapes live here (readiness owns the
//! "what is launchable" vocabulary); the derivation — joining the active
//! catalog, agent readiness, and classified auth contexts — is a sessions
//! use case (`sessions/service/launch_options.rs`).

#[derive(Debug, Clone)]
pub struct ResolvedLaunchModelOption {
    pub id: String,
    pub display_name: String,
    pub aliases: Vec<String>,
    pub is_default: bool,
    pub default_opt_in: Option<bool>,
}

#[derive(Debug, Clone)]
pub struct ResolvedLaunchAgentOption {
    pub kind: String,
    pub display_name: String,
    pub default_model_id: Option<String>,
    pub models: Vec<ResolvedLaunchModelOption>,
}

#[derive(Debug, Clone)]
pub struct ResolvedWorkspaceLaunchOptions {
    pub agents: Vec<ResolvedLaunchAgentOption>,
}
