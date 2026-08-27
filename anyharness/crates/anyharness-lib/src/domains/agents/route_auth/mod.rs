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
pub mod plan;
pub mod probe_materialization;
pub mod profile;
pub mod refusal;
pub mod render;
pub mod rotation;
pub mod state;

#[cfg(test)]
mod gateway_plan_tests;
#[cfg(test)]
mod origin_guard_tests;
#[cfg(test)]
mod render_tests;
#[cfg(test)]
mod seat_rotation_tests;
#[cfg(test)]
pub(crate) mod test_support;

use std::path::{Path, PathBuf};

use crate::domains::agents::seat_cooling::SeatCoolingStore;

pub use plan::{GatewayModelPlan, GatewayModelResolve};
pub use probe_materialization::{
    materialize_for_probe, probe_auth_material, sweep_probe_scratch, ProbeAuthMaterial,
    ProbeAuthMaterialization, ProbeScratch,
};
pub use profile::{resolve_profile, AgentRuntimeAuthProfile};
pub use refusal::LaunchRefusal;
pub use render::{render_profile, RenderedRouteAuth};
pub use rotation::{
    decide_rotation, seat_rotation_readout, seat_rotation_readout_via_db, RotationDecision,
};
pub use state::{
    apply_state_file, clear_state_file, load_state_file, state_file_path, AgentAuthState,
    AppliedStateOutcome, ClearedStateOutcome,
};

/// Errors from the route-auth render plane.
#[derive(Debug, thiserror::Error)]
pub enum RouteAuthError {
    #[error("agent-auth state file is malformed ({path}): {detail}")]
    MalformedStateFile { path: PathBuf, detail: String },
    #[error(
        "stale agent-auth state push: incoming sequence {incoming} is below \
         the persisted sequence {current}"
    )]
    StaleStateSequence { incoming: i64, current: i64 },
    /// The harness has an entry in the document whose sources could not be
    /// satisfied — a selection the machine cannot honor. Constructed by
    /// [`resolve_profile`] and refused at both create and launch, per
    /// agent-auth.md's "present-but-empty fails closed".
    ///
    /// The Display copy speaks plain words (agent_auth spec: "Refusals speak
    /// plain words") naming the likely causes and the action; it is produced
    /// by [`refusal::source_unsatisfied_copy`], the SAME producer behind
    /// [`refusal::LaunchRefusal::SourceUnsatisfied`], so the launch surface
    /// and the error can never say different things. Absent a typed reason
    /// the copy names the family — a revoked seat or key, or exhausted
    /// credits — rather than fabricating certainty.
    ///
    /// `SelectionConflict` used to sit beside this, for "N entries where one is
    /// allowed". It is deleted rather than wired: source cardinality is a
    /// per-harness SERVER rule (`selection_rules.py`) enforced before a document
    /// is ever written, and the document's shape — one entry per harness with a
    /// flat source list — cannot represent the conflict it described. There was
    /// no input a correct runtime could construct it from.
    ///
    /// `reason` is the document's `unsatisfied_reason` — the server's typed
    /// plain-words cause when it knows one — after `profile.rs` clamps it to
    /// short, word-shaped text (an over-long or token-shaped value is dropped
    /// to the family sentence, since this Display reaches shipped logs).
    /// `sequence` stays for logs/tracing but no longer rides the Display copy.
    #[error("{}", refusal::source_unsatisfied_copy(harness_kind, reason.as_deref()))]
    SelectionMissing {
        harness_kind: String,
        sequence: i64,
        reason: Option<String>,
    },
    /// Rotation is off and the pinned seat is cooling (a live limit error was
    /// observed and its reset has not passed). 409: launches wait for this
    /// login rather than silently rotating off the user's pin.
    #[error("{}", refusal::seat_cooling_copy(*reset_at_epoch_s))]
    SeatCooling {
        harness_kind: String,
        /// The vault seat uuid — never token material.
        seat_id: String,
        reset_at_epoch_s: i64,
    },
    /// Every seat in the pool is cooling and no non-seat source exists to
    /// fall back to. 409, naming the earliest reset.
    #[error("{}", refusal::all_seats_cooling_copy(*earliest_reset_epoch_s))]
    AllSeatsCooling {
        harness_kind: String,
        earliest_reset_epoch_s: i64,
    },
    #[error("agent-auth source for '{harness_kind}' is incomplete: {detail}")]
    SelectionIncomplete {
        harness_kind: String,
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
            Self::StaleStateSequence { .. } => "AGENT_ROUTE_STATE_STALE",
            Self::SelectionMissing { .. } => "AGENT_ROUTE_SELECTION_MISSING",
            Self::SeatCooling { .. } => "AGENT_ROUTE_SEAT_COOLING",
            Self::AllSeatsCooling { .. } => "AGENT_ROUTE_ALL_SEATS_COOLING",
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

/// Resolve the auth profile that a launch will actually use, including the
/// desktop server-origin guard. Auth/readiness and the launch-options probe call
/// this same seam so neither can reason about a route the launcher will ignore.
pub(crate) fn resolve_launch_auth_profile(
    runtime_home: &Path,
    harness_kind: &str,
) -> Result<AgentRuntimeAuthProfile, RouteAuthError> {
    let state = load_effective_state(runtime_home, current_server_origin().as_deref())?;
    resolve_profile(state.as_ref(), harness_kind)
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
/// isolated routed homes). Absent file → an empty (native) delta.
///
/// ROTATION-UNAWARE: a seat pool renders its first seat (slice-1 behavior).
/// This is deliberately what probe/readiness/materialization callers keep —
/// probing must be deterministic and must never consult or advance rotation
/// state. The session-launch path calls
/// [`resolve_launch_route_auth_rotated`] instead.
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
    let sequence = state.as_ref().map(|state| state.sequence).unwrap_or(0);
    let profile = resolve_profile(state.as_ref(), harness_kind)?;
    let plan = resolver.resolve_gateway_models(harness_kind, sequence);
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
    match resolve_profile(state.as_ref(), harness_kind) {
        Ok(_) => None,
        Err(error) => Some(error),
    }
}

/// Rotation-aware [`resolve_launch_route_auth`] — the SESSION-LAUNCH entry
/// point (create/resume/fork/prompt all converge on `start_live_session`,
/// which calls this). Before rendering, the seat-rotation seam picks exactly
/// one seat from the profile's pool (spec §4 cell 2, "Rotation ownership")
/// using the store's cooling and last-served facts. Non-seat profiles pass
/// through untouched. NOTHING here advances rotation state: `last_served`
/// moves only when the spawned process actually starts
/// (`SeatCoolingStore::confirm_served`, the actor's post-spawn point).
pub fn resolve_launch_route_auth_rotated(
    runtime_home: &Path,
    harness_kind: &str,
    resolver: &dyn GatewayModelResolve,
    store: &SeatCoolingStore,
) -> Result<RenderedRouteAuth, RouteAuthError> {
    resolve_launch_route_auth_rotated_for_server(
        runtime_home,
        harness_kind,
        resolver,
        store,
        current_server_origin().as_deref(),
    )
}

/// Core of [`resolve_launch_route_auth_rotated`], parameterized on the server
/// origin for the same testability reason as
/// [`resolve_launch_route_auth_for_server`].
fn resolve_launch_route_auth_rotated_for_server(
    runtime_home: &Path,
    harness_kind: &str,
    resolver: &dyn GatewayModelResolve,
    store: &SeatCoolingStore,
    current_server_origin: Option<&str>,
) -> Result<RenderedRouteAuth, RouteAuthError> {
    let state = load_effective_state(runtime_home, current_server_origin)?;
    let sequence = state.as_ref().map(|state| state.sequence).unwrap_or(0);
    let mut profile = resolve_profile(state.as_ref(), harness_kind)?;
    if let AgentRuntimeAuthProfile::Sources(sources) = &mut profile {
        apply_rotation_seam(sources, store)?;
    }
    let plan = resolver.resolve_gateway_models(harness_kind, sequence);
    let rendered = render_profile(&profile, harness_kind, &plan, runtime_home)?;
    for spec in &rendered.files {
        materialize::apply_file_spec(runtime_home, spec)?;
    }
    Ok(rendered)
}

/// Rotation-aware [`launch_route_selection_failure`]: the create-time preview.
/// Runs the SAME rotation decision as the launch seam — without materializing,
/// rendering, or advancing anything — so session create 409s with the exact
/// refusal sentence the launch itself would produce (cooling included).
pub fn launch_route_selection_failure_rotated(
    runtime_home: &Path,
    harness_kind: &str,
    store: &SeatCoolingStore,
) -> Option<RouteAuthError> {
    launch_route_selection_failure_rotated_for_server(
        runtime_home,
        harness_kind,
        store,
        current_server_origin().as_deref(),
    )
}

fn launch_route_selection_failure_rotated_for_server(
    runtime_home: &Path,
    harness_kind: &str,
    store: &SeatCoolingStore,
    current_server_origin: Option<&str>,
) -> Option<RouteAuthError> {
    // Same tolerance policy as `launch_route_selection_failure_for_server`.
    let state = load_effective_state(runtime_home, current_server_origin).ok()?;
    match resolve_profile(state.as_ref(), harness_kind) {
        Ok(AgentRuntimeAuthProfile::Sources(mut sources)) => {
            apply_rotation_seam(&mut sources, store).err()
        }
        Ok(AgentRuntimeAuthProfile::Native) => None,
        Err(error) => Some(error),
    }
}

/// The seat-rotation seam (work order G): run the pure decision over the
/// profile's seat pool in DOCUMENT order (deduplicated — `rotation::seat_pool`),
/// then reduce the sources so the chosen seat renders ALONE: every other
/// source, seat or not, is dropped. A gateway/api_key/provider_config source
/// beside a pool is fallback-only — rendering it next to the seat would hand
/// the CLI two competing credentials (`ANTHROPIC_AUTH_TOKEN` +
/// `CLAUDE_CODE_OAUTH_TOKEN`) while `serving_seat_id` names the seat, so a
/// limit error would cool the seat no matter which credential the CLI used.
/// When no seat can serve — the pool is all-cooling, or the pin is cooling —
/// a profile that ALSO carries a non-seat source drops its seats and renders
/// the rest (the gateway fallback, `serving_seat_id = None`); a seat-only
/// profile refuses with the matching typed error.
///
/// Pure with respect to rotation state: reads the store, never writes it —
/// which is what makes the create-time preview and the launch render safe to
/// run any number of times.
fn apply_rotation_seam(
    sources: &mut profile::HarnessSources,
    store: &SeatCoolingStore,
) -> Result<(), RouteAuthError> {
    use profile::ResolvedSource;
    let pool = rotation::seat_pool(sources);
    if pool.is_empty() {
        return Ok(());
    }
    let now_epoch_s = chrono::Utc::now().timestamp();
    let cooling = store.cooling_map(&sources.harness_kind, now_epoch_s);
    let last_served = store.last_served(&sources.harness_kind);
    match rotation::decide_rotation(&pool, sources.rotate, last_served.as_deref(), &cooling) {
        RotationDecision::Serve { seat_id } => {
            // Exactly one source survives: the FIRST occurrence of the chosen
            // seat (a repeated id must not render twice either).
            let mut kept = false;
            sources.sources.retain(|source| {
                let hit = !kept
                    && matches!(source, ResolvedSource::Seat(seat) if seat.seat_id == seat_id);
                kept |= hit;
                hit
            });
            Ok(())
        }
        RotationDecision::AllCooling {
            earliest_reset_epoch_s,
        } => {
            let harness_kind = sources.harness_kind.clone();
            drop_seats_or_refuse(sources, move || RouteAuthError::AllSeatsCooling {
                harness_kind: harness_kind.clone(),
                earliest_reset_epoch_s,
            })
        }
        RotationDecision::PinnedCooling {
            seat_id,
            reset_at_epoch_s,
        } => {
            let harness_kind = sources.harness_kind.clone();
            drop_seats_or_refuse(sources, move || RouteAuthError::SeatCooling {
                harness_kind: harness_kind.clone(),
                seat_id: seat_id.clone(),
                reset_at_epoch_s,
            })
        }
    }
}

/// The cooling fallback rule shared by both no-seat-can-serve outcomes: keep
/// the profile's non-seat sources when any exist, else the given refusal.
fn drop_seats_or_refuse(
    sources: &mut profile::HarnessSources,
    refusal: impl Fn() -> RouteAuthError,
) -> Result<(), RouteAuthError> {
    use profile::ResolvedSource;
    let has_non_seat = sources
        .sources
        .iter()
        .any(|source| !matches!(source, ResolvedSource::Seat(_)));
    if has_non_seat {
        sources
            .sources
            .retain(|source| !matches!(source, ResolvedSource::Seat(_)));
        Ok(())
    } else {
        Err(refusal())
    }
}
