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
pub mod plan;
pub mod profile;
pub mod render;
pub mod state;

#[cfg(test)]
mod origin_guard_tests;
#[cfg(test)]
mod render_tests;
#[cfg(test)]
pub(crate) mod test_support;

use std::path::{Path, PathBuf};

pub use plan::{GatewayModelPlan, GatewayModelResolve};
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

/// The env var the desktop Tauri launcher sets (from the app's own
/// `apiBaseUrl` config, see `sidecar.rs::build_spawn_command`) to the origin
/// of the server it currently points at. Absent for cloud sandboxes and any
/// context outside the desktop-embedded runtime.
const CURRENT_SERVER_ORIGIN_ENV: &str = "PROLIFERATE_API_BASE_URL_ORIGIN";

fn current_server_origin() -> Option<String> {
    std::env::var(CURRENT_SERVER_ORIGIN_ENV)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// End-to-end at launch: load the state file, resolve the profile for
/// `harness_kind`, resolve the catalog-driven [`GatewayModelPlan`], render its
/// env delta (PURE), then apply the rendered file specs to disk (materializing
/// isolated homes). Absent file → an empty (native) delta. This is the single
/// entry point the session runtime calls.
///
/// Render consumes ONLY the plan for model values (spec §3): no constants, no
/// lookups. Two-phase (contract §4): [`render_profile`] performs no I/O; the
/// launcher (here) writes the [`RenderedRouteAuth::files`] via the materialize
/// helpers.
pub fn resolve_launch_route_auth(
    runtime_home: &Path,
    harness_kind: &str,
    resolver: &dyn GatewayModelResolve,
) -> Result<RenderedRouteAuth, RouteAuthError> {
    resolve_launch_route_auth_for_server(
        runtime_home,
        harness_kind,
        resolver,
        current_server_origin().as_deref(),
    )
}

/// Core of [`resolve_launch_route_auth`], parameterized on the current server
/// origin so the server-switch guard is unit-testable without mutating
/// process-global env state (tests run concurrently in this crate).
///
/// Server-switch guard: a state file stamped for a DIFFERENT server than
/// `current_server_origin` is discarded (treated as absent, i.e.
/// `Native`/no-injection) rather than rendering a launch that would inject the
/// abandoned server's gateway token. This only ever changes behavior for a
/// desktop that just switched servers and is mid-re-enrollment; see
/// [`super::state::AgentAuthState::matches_server_origin`] for the exact
/// match/backward-compat rules.
fn resolve_launch_route_auth_for_server(
    runtime_home: &Path,
    harness_kind: &str,
    resolver: &dyn GatewayModelResolve,
    current_server_origin: Option<&str>,
) -> Result<RenderedRouteAuth, RouteAuthError> {
    let state = load_state_file(runtime_home)?;
    let state = state.filter(|state| state.matches_server_origin(current_server_origin));
    let revision = state.as_ref().map(|state| state.revision).unwrap_or(0);
    let profile = resolve_profile(state.as_ref(), harness_kind)?;
    let plan = resolver.resolve_gateway_models(harness_kind, revision);
    let rendered = render_profile(&profile, &plan, runtime_home)?;
    for spec in &rendered.files {
        materialize::apply_file_spec(runtime_home, spec)?;
    }
    Ok(rendered)
}

/// Does the enrolled agent-auth state provide launch credentials for
/// `harness_kind` right now? True iff [`resolve_launch_route_auth`] would inject
/// a non-native route (a resolved [`AgentRuntimeAuthProfile::Sources`]: any
/// gateway or `api_key` source), applying the SAME server-origin guard the
/// launcher applies.
///
/// This is the single source readiness consults so it judges the EXACT
/// credential state the launcher will inject at spawn (issue #1106): a
/// gateway/api_key route makes the agent credential-ready without the operator
/// copying gateway credentials into a workspace env file. A malformed, absent,
/// origin-mismatched, or native state → `false` (native readiness governs).
pub fn launch_route_provides_credentials(runtime_home: &Path, harness_kind: &str) -> bool {
    launch_route_provides_credentials_for_server(
        runtime_home,
        harness_kind,
        current_server_origin().as_deref(),
    )
}

/// Core of [`launch_route_provides_credentials`], parameterized on the current
/// server origin so the server-switch guard is unit-testable without mutating
/// process-global env state. Deliberately mirrors
/// [`resolve_launch_route_auth_for_server`]'s state load + origin filter +
/// [`resolve_profile`] so readiness and launch never disagree on whether a
/// route is in effect. A malformed/unresolvable state is treated as "no route"
/// (native readiness governs) rather than an error — readiness must never fail
/// closed on a state file the launcher itself tolerates.
fn launch_route_provides_credentials_for_server(
    runtime_home: &Path,
    harness_kind: &str,
    current_server_origin: Option<&str>,
) -> bool {
    let state = match load_state_file(runtime_home) {
        Ok(state) => state,
        Err(error) => {
            tracing::debug!(
                harness_kind,
                %error,
                "agent-auth state unreadable for readiness; native readiness governs"
            );
            return false;
        }
    };
    let state = state.filter(|state| state.matches_server_origin(current_server_origin));
    matches!(
        resolve_profile(state.as_ref(), harness_kind),
        Ok(AgentRuntimeAuthProfile::Sources(_))
    )
}
