//! The derived launch-options view: which agents a session can launch and
//! which models their menus show. The shapes live here (readiness owns the
//! "what is launchable" vocabulary); the derivation — joining the active
//! catalog, agent readiness, and classified auth contexts — is a sessions
//! use case (`sessions/service/launch_options.rs`).

/// The thinking/effort control joined from the bundled catalog for a launch
/// model option (`controls.effort.{values, observedValue}`).
#[derive(Debug, Clone)]
pub struct ResolvedModelEffort {
    pub values: Vec<String>,
    pub default: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ResolvedLaunchModelOption {
    pub id: String,
    pub display_name: String,
    pub aliases: Vec<String>,
    pub is_default: bool,
    pub default_opt_in: Option<bool>,
    // --- Enriched catalog fields (joined the same way as the gateway-models
    // endpoint) so the native/api_key upload snapshot carries rich rows. ---
    pub description: Option<String>,
    pub provider: Option<String>,
    pub status: Option<crate::domains::agents::model::ModelCatalogStatus>,
    pub effort: Option<ResolvedModelEffort>,
    pub fast_mode: bool,
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
