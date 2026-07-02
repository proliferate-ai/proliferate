//! Runtime auth-profile ingestion + per-harness launch rendering.
//!
//! This is the AnyHarness "render plane" (spec §1) for the LiteLLM agent-auth
//! model. It is deliberately separate from the kept `agents/auth/` module,
//! which owns *native* credential detection and interactive login; this module
//! owns the declarative *route* selections delivered by the control plane.
//!
//! Flow at each session launch:
//!
//! ```text
//! state.json (<home>/agent-auth/state.json, 0600)
//!   → load_state_file            (state.rs: tolerant read+parse)
//!   → resolve_profile(harness)   (profile.rs: pure route decision, fail-closed)
//!   → render_profile             (render.rs + materialize.rs: env delta + FS)
//!   → RenderedRouteAuth { set, remove } merged into the launch env
//! ```
//!
//! No watch/refresh: the file is read fresh per launch (spec §1). Absent file
//! = legacy/native behavior; present-and-scoped file with no selection for the
//! requested harness = fail-closed error.

mod materialize;
pub mod profile;
pub mod render;
pub mod state;

#[cfg(test)]
mod render_tests;
#[cfg(test)]
pub(crate) mod test_support;

use std::path::{Path, PathBuf};

pub use profile::{resolve_profile, AgentRuntimeAuthProfile};
pub use render::{render_profile, RenderedRouteAuth};
pub use state::{load_state_file, state_file_path, AgentAuthState, AuthRoute, AuthSelection};

use state::AuthRoute as RouteKind;

/// Errors from the route-auth render plane. `SelectionMissing` is the
/// fail-closed error (spec §3): a scoped state file with no selection for the
/// requested harness must error rather than fall through to ambient creds.
#[derive(Debug, thiserror::Error)]
pub enum RouteAuthError {
    #[error("agent-auth state file is malformed ({path}): {detail}")]
    MalformedStateFile { path: PathBuf, detail: String },
    #[error("no agent-auth route selection for harness '{harness_kind}' at revision {revision}")]
    SelectionMissing { harness_kind: String, revision: i64 },
    #[error("agent-auth route selection for '{harness_kind}' is incomplete: {detail}")]
    SelectionIncomplete {
        harness_kind: String,
        route: RouteKind,
        detail: String,
    },
    #[error("agent-auth route for '{harness_kind}' is unsupported: {detail}")]
    UnsupportedRoute {
        harness_kind: String,
        detail: String,
    },
    #[error("unknown harness kind '{harness_kind}' in agent-auth state")]
    UnknownHarness { harness_kind: String },
    #[error("failed to materialize agent-auth harness state: {detail}")]
    Materialize { detail: String },
}

impl RouteAuthError {
    /// Stable machine code for the API/contract surface. `SelectionMissing`
    /// maps to the fail-closed code consumed by the desktop/cloud UIs.
    pub fn code(&self) -> &'static str {
        match self {
            Self::MalformedStateFile { .. } => "AGENT_ROUTE_STATE_MALFORMED",
            Self::SelectionMissing { .. } => "AGENT_ROUTE_SELECTION_MISSING",
            Self::SelectionIncomplete { .. } => "AGENT_ROUTE_SELECTION_INCOMPLETE",
            Self::UnsupportedRoute { .. } => "AGENT_ROUTE_UNSUPPORTED",
            Self::UnknownHarness { .. } => "AGENT_ROUTE_UNKNOWN_HARNESS",
            Self::Materialize { .. } => "AGENT_ROUTE_MATERIALIZE_FAILED",
        }
    }
}

/// End-to-end at launch: load the state file, resolve the profile for
/// `harness_kind`, and render its env delta (materializing isolated homes as a
/// side effect). Absent file → an empty (native) delta. This is the single
/// entry point the session runtime calls.
pub fn resolve_launch_route_auth(
    runtime_home: &Path,
    harness_kind: &str,
) -> Result<RenderedRouteAuth, RouteAuthError> {
    let state = load_state_file(runtime_home)?;
    let profile = resolve_profile(state.as_ref(), harness_kind)?;
    render_profile(&profile, runtime_home)
}
