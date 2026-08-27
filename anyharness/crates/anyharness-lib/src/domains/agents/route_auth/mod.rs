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
//! No watch/refresh: the file is read fresh per launch. An absent file or absent
//! harness means native behavior (empty delta), where the harness's own login
//! owns auth. A present harness with no satisfiable sources fails closed.

pub(crate) mod gateway_plan;
mod gateway_probe;
mod materialize;
pub mod native_bridge;
pub mod plan;
pub mod probe_materialization;
pub mod profile;
pub mod render;
pub mod state;

#[cfg(test)]
mod gateway_plan_tests;
#[cfg(test)]
mod origin_guard_tests;
#[cfg(test)]
mod render_tests;
#[cfg(test)]
pub(crate) mod test_support;

use std::path::{Path, PathBuf};

pub use native_bridge::{
    clear_native_bridge_flag, clear_native_bridge_flags_for_document, legacy_native_granted,
    pending_native_bridge_harnesses, seed_native_bridge_at_startup, seed_native_bridge_once,
    NativeBridgeSeedOutcome,
};
pub use plan::{GatewayModelPlan, GatewayModelResolve};
pub use probe_materialization::{
    materialize_for_probe, probe_auth_material, sweep_probe_scratch, ProbeAuthMaterial,
    ProbeAuthMaterialization, ProbeScratch,
};
pub use profile::{resolve_profile, AgentRuntimeAuthProfile};
pub use render::{render_profile, RenderedRouteAuth};
pub use state::{
    apply_state_file, clear_state_file, load_state_file, state_file_path, AgentAuthState,
};

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
    /// The harness has an entry in the document whose sources could not be
    /// satisfied — a selection the machine cannot honor. Constructed by
    /// [`resolve_profile`] and refused at both create and launch, per
    /// agent-auth.md's "present-but-empty fails closed".
    ///
    /// `SelectionConflict` used to sit beside this, for "N entries where one is
    /// allowed". It is deleted rather than wired: source cardinality is a
    /// per-harness SERVER rule (`selection_rules.py`) enforced before a document
    /// is ever written, and the document's shape — one entry per harness with a
    /// flat source list — cannot represent the conflict it described. There was
    /// no input a correct runtime could construct it from.
    #[error("no agent-auth route selection for harness '{harness_kind}' at revision {revision}")]
    SelectionMissing { harness_kind: String, revision: i64 },
    /// The harness has NO entry in the document and the absent-harness policy
    /// is [`AbsentHarnessPolicy::Refuse`] (the final convention: zero enabled
    /// selections means unconfigured). Raised only by
    /// [`resolve_profile_bridged`], and only for a harness the native-migration
    /// bridge does not hold a legacy flag for. Speaks plain words; shares the
    /// selection-missing wire code (the spec's refusal variants all render
    /// under it).
    #[error("{harness_kind} isn't set up — pick a method in Settings → Agents")]
    NoConfiguredSource { harness_kind: String },
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
            Self::SelectionMissing { .. } | Self::NoConfiguredSource { .. } => {
                "AGENT_ROUTE_SELECTION_MISSING"
            }
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

pub(crate) fn current_server_origin() -> Option<String> {
    std::env::var(CURRENT_SERVER_ORIGIN_ENV)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// What a launch does for a harness that has NO entry in the applied document.
///
/// This is the zero-rows convention, as one value. Today's convention is
/// [`Self::Native`] ("absent means native": the harness launches on its own
/// login). The final convention (agent_auth spec, flow 3) is [`Self::Refuse`]
/// ("zero enabled rows means unconfigured": a plain-words refusal). The
/// native-migration bridge ([`native_bridge`]) sits in front of either: a
/// harness holding a legacy flag launches native under both.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AbsentHarnessPolicy {
    Native,
    Refuse,
}

/// The convention THIS build applies — the one place the cutover flips.
///
/// The refusal cutover (the typed refusal set, slice 2 of the auth rebuild)
/// changes this constant to [`AbsentHarnessPolicy::Refuse`] and nothing else:
/// every launch-path caller already resolves through
/// [`resolve_profile_bridged`], so the bridge's grant is honored the moment
/// the flip lands. Pre-cutover native users never see the refusal.
pub const ABSENT_HARNESS_POLICY: AbsentHarnessPolicy = AbsentHarnessPolicy::Native;

/// [`resolve_profile`] with the native-migration bridge in front of the
/// absent-harness convention. The ONE seam the cutover consults:
///
/// - harness present in the document → [`resolve_profile`] decides (a
///   present-but-empty entry still fails closed; the bridge never overrides an
///   explicit selection);
/// - harness absent + `legacy_native_granted` → [`AgentRuntimeAuthProfile::Native`];
/// - harness absent + no grant → `policy` decides.
pub fn resolve_profile_bridged(
    state: Option<&AgentAuthState>,
    harness_kind: &str,
    policy: AbsentHarnessPolicy,
    legacy_native_granted: bool,
) -> Result<AgentRuntimeAuthProfile, RouteAuthError> {
    let absent = state.is_none_or(|state| state.sources_for(harness_kind).is_none());
    if !absent {
        return resolve_profile(state, harness_kind);
    }
    if legacy_native_granted {
        tracing::debug!(
            harness_kind,
            "harness absent from agent-auth state; legacy native bridge keeps native behavior"
        );
        return Ok(AgentRuntimeAuthProfile::Native);
    }
    match policy {
        AbsentHarnessPolicy::Native => Ok(AgentRuntimeAuthProfile::Native),
        AbsentHarnessPolicy::Refuse => Err(RouteAuthError::NoConfiguredSource {
            harness_kind: harness_kind.to_string(),
        }),
    }
}

/// The launch-path resolution: [`resolve_profile_bridged`] under this build's
/// [`ABSENT_HARNESS_POLICY`] with the bridge's grant read from the runtime home.
fn resolve_profile_for_launch(
    runtime_home: &Path,
    state: Option<&AgentAuthState>,
    harness_kind: &str,
) -> Result<AgentRuntimeAuthProfile, RouteAuthError> {
    resolve_profile_bridged(
        state,
        harness_kind,
        ABSENT_HARNESS_POLICY,
        native_bridge::legacy_native_granted(runtime_home, harness_kind),
    )
}

/// Resolve the auth profile that a launch will actually use, including the
/// desktop server-origin guard. Auth/readiness and the launch-options probe call
/// this same seam so neither can reason about a route the launcher will ignore.
pub(crate) fn resolve_launch_auth_profile(
    runtime_home: &Path,
    harness_kind: &str,
) -> Result<AgentRuntimeAuthProfile, RouteAuthError> {
    let state = load_effective_state(runtime_home, current_server_origin().as_deref())?;
    resolve_profile_for_launch(runtime_home, state.as_ref(), harness_kind)
}

pub(crate) fn load_effective_state(
    runtime_home: &Path,
    current_server_origin: Option<&str>,
) -> Result<Option<AgentAuthState>, RouteAuthError> {
    Ok(load_state_file(runtime_home)?
        .filter(|state| state.matches_server_origin(current_server_origin)))
}

/// End-to-end at launch: load the state file, resolve the profile for
/// `harness_kind`, read the live gateway [`GatewayModelPlan`], render its env
/// delta (PURE), then apply the rendered file specs to disk (materializing
/// isolated routed homes). Absent file → an empty (native) delta. This is the
/// single entry point the session runtime calls.
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
    let state = load_effective_state(runtime_home, current_server_origin)?;
    let revision = state.as_ref().map(|state| state.revision).unwrap_or(0);
    let profile = resolve_profile_for_launch(runtime_home, state.as_ref(), harness_kind)?;
    let plan = resolver.resolve_gateway_models(harness_kind, revision);
    let rendered = render_profile(&profile, harness_kind, &plan, runtime_home)?;
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
    let state = match load_effective_state(runtime_home, current_server_origin) {
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
    matches!(
        resolve_profile(state.as_ref(), harness_kind),
        Ok(AgentRuntimeAuthProfile::Sources(_))
    )
}

/// Is `harness_kind`'s enrolled selection unsatisfiable right now?
///
/// `Some(error)` exactly when [`resolve_profile`] fails closed — the harness has
/// an entry in the document whose sources the renderer could not satisfy
/// (agent-auth.md: "present-but-empty fails closed"). `None` for native, for a
/// usable route, and for any state the launcher itself tolerates.
///
/// Session create calls this so the refusal is a **typed 409 naming the auth
/// problem** rather than the generic "agent is not ready" the readiness gate
/// would otherwise produce. Both refuse the launch; only this one tells the user
/// their selected route is dead instead of implying their CLI needs installing.
/// The launch path (`start_live_session`) reaches the same conclusion through
/// `resolve_launch_route_auth`, so a session that slips past create is still
/// refused — this is the earlier, better-labelled gate, never the only one.
pub fn launch_route_selection_failure(
    runtime_home: &Path,
    harness_kind: &str,
) -> Option<RouteAuthError> {
    launch_route_selection_failure_for_server(
        runtime_home,
        harness_kind,
        current_server_origin().as_deref(),
    )
}

fn launch_route_selection_failure_for_server(
    runtime_home: &Path,
    harness_kind: &str,
    current_server_origin: Option<&str>,
) -> Option<RouteAuthError> {
    // A state file the launcher tolerates must not be turned into a create-time
    // rejection here: an unreadable/origin-mismatched document is "no route",
    // and native readiness governs (identical policy to
    // `launch_route_provides_credentials_for_server`).
    let state = load_effective_state(runtime_home, current_server_origin).ok()?;
    // Same bridged resolution as the launch itself: create-time must not
    // refuse a harness the launcher would run (the bridge's grant included).
    match resolve_profile_for_launch(runtime_home, state.as_ref(), harness_kind) {
        Ok(_) => None,
        Err(error) => Some(error),
    }
}
