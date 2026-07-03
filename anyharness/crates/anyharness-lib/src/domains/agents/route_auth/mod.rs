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
//!   → load_state_file            (state.rs: tolerant read+parse, v2)
//!   → resolve_profile(harness)   (profile.rs: pure source resolution)
//!   → render_profile             (render.rs: PURE env delta + FileSpecs)
//!   → apply file specs           (materialize.rs: launcher-side FS writes)
//!   → RenderedRouteAuth { set, remove } merged into the launch env
//! ```
//!
//! No watch/refresh: the file is read fresh per launch. Absent file, absent
//! harness, or empty sources = native behavior (empty delta) — the harness's
//! own login owns auth.

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
pub use state::{apply_state_file, load_state_file, state_file_path, AgentAuthState};

/// Errors from the route-auth render plane.
#[derive(Debug, thiserror::Error)]
pub enum RouteAuthError {
    #[error("agent-auth state file is malformed ({path}): {detail}")]
    MalformedStateFile { path: PathBuf, detail: String },
    #[error(
        "stale agent-auth state push: incoming revision {incoming} is below \
         the persisted revision {current}"
    )]
    StaleStateRevision { incoming: i64, current: i64 },
    #[error("no agent-auth route selection for harness '{harness_kind}' at revision {revision}")]
    SelectionMissing { harness_kind: String, revision: i64 },
    #[error(
        "conflicting agent-auth selections for harness '{harness_kind}': \
         {count} entries where one is allowed"
    )]
    SelectionConflict { harness_kind: String, count: usize },
    #[error("agent-auth source for '{harness_kind}' is incomplete: {detail}")]
    SelectionIncomplete { harness_kind: String, detail: String },
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
            Self::StaleStateRevision { .. } => "AGENT_ROUTE_STATE_STALE",
            Self::SelectionMissing { .. } => "AGENT_ROUTE_SELECTION_MISSING",
            Self::SelectionConflict { .. } => "AGENT_ROUTE_SELECTION_CONFLICT",
            Self::SelectionIncomplete { .. } => "AGENT_ROUTE_SELECTION_INCOMPLETE",
            Self::UnsupportedRoute { .. } => "AGENT_ROUTE_UNSUPPORTED",
            Self::UnknownHarness { .. } => "AGENT_ROUTE_UNKNOWN_HARNESS",
            Self::Materialize { .. } => "AGENT_ROUTE_MATERIALIZE_FAILED",
        }
    }
}

/// End-to-end at launch: load the state file, resolve the profile for
/// `harness_kind`, render its env delta (PURE), then apply the rendered file
/// specs to disk (materializing isolated homes). Absent file → an empty
/// (native) delta. This is the single entry point the session runtime calls.
///
/// Two-phase (contract §4): [`render_profile`] performs no I/O; the launcher
/// (here) writes the [`RenderedRouteAuth::files`] via the materialize helpers.
pub fn resolve_launch_route_auth(
    runtime_home: &Path,
    harness_kind: &str,
) -> Result<RenderedRouteAuth, RouteAuthError> {
    let state = load_state_file(runtime_home)?;
    let profile = resolve_profile(state.as_ref(), harness_kind)?;
    let rendered = render_profile(&profile, runtime_home)?;
    for spec in &rendered.files {
        materialize::apply_file_spec(runtime_home, spec)?;
    }
    Ok(rendered)
}
