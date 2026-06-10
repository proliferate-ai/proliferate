//! Agent auth: encrypted selection config, local credential detection, and
//! interactive login. One concern, one service surface.

mod codex_config;
pub mod credentials;
mod launch;
pub mod login;
pub mod login_terminal;
mod overlay_policy;
mod scope;
mod service;
mod status;
mod store;
mod validation;

pub use service::{
    AgentAuthConfigApplyOutcome, AgentAuthConfigInput, AgentAuthConfigStatus,
    AgentAuthLaunchOverlay, AgentAuthLaunchOverlayError, AgentAuthSelectionRequired,
    AgentAuthService,
};
pub use store::AgentAuthConfigStore;

#[cfg(test)]
mod claude_tests;

#[cfg(test)]
mod scope_tests;

#[cfg(test)]
mod tests;
