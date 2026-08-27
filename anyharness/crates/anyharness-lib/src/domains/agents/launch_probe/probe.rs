//! The runner: one probe attempt, on a dedicated thread that owns both the
//! harness child and the scratch root.
//!
//! `probe_agent` requires a `LocalSet` (the ACP connection uses `spawn_local`, so
//! a bare `tokio::spawn` will not do) and carries no timeout of its own, so the
//! launch-options reconciler bounds each probe. The shape is the
//! dedicated-thread + current-thread-runtime + `LocalSet::block_on` pattern
//! production sessions already use.
//!
//! **Why the timeout and the scratch guard live INSIDE the thread.** The obvious
//! arrangement — timeout in the caller's frame, guard dropped by the caller — is
//! wrong twice over:
//!
//! 1. `kill_on_drop(true)` fires when the `tokio::process::Child` is dropped, and
//!    the child lives in THIS thread's frames. Dropping the caller's future drops
//!    only a `oneshot` receiver, so the harness process would leak.
//! 2. Dropping the scratch from the caller would delete
//!    `<scratch>/agent-auth/claude-config` or `codex-home-<rev>/config.toml` out
//!    from under a harness still reading them.
//!
//! So the caller gets a [`CancellationToken`] and a completion channel, and the
//! thread owns everything effectful. On timeout and on cancellation the
//! `probe_agent` future is dropped on its own runtime, so `kill_on_drop` actually
//! fires; the guard drops afterwards, on the same thread, once the child is gone.
//!
//! The caller deliberately does not join the OS thread (that would make an async
//! fn block). The thread is bounded by `per_probe_timeout` and owns all of its own
//! cleanup; if the whole process dies mid-probe, the startup orphan sweep reclaims
//! the root.

use std::path::PathBuf;
use std::time::Duration;

use tokio_util::sync::CancellationToken;

use crate::domains::agents::live_ports::{probe_agent, ProbeOptions, ProbeSnapshot};
use crate::domains::agents::model::AgentKind;
use crate::domains::agents::readiness::service::resolve_agent_unrouted_by_kind;
use crate::domains::agents::route_auth::{
    self, GatewayModelPlan, ProbeAuthMaterial, RouteAuthError,
};

#[derive(Debug, thiserror::Error)]
pub enum ProbeError {
    #[error("agent-auth materialization for the probe failed: {0}")]
    Materialize(#[from] RouteAuthError),
    #[error("probe timed out")]
    Timeout,
    #[error("probe was cancelled")]
    Cancelled,
    /// The harness process could not be spawned at all (missing executable, exec
    /// error). Distinct from `Failed`/`Timeout` so a wedged or absent binary
    /// FAST-FAILS with a named code (ADR FR-2, A5) instead of waiting out
    /// `per_probe_timeout`: a spawn that never starts has nothing to time out on.
    #[error("probe spawn failed: {detail}")]
    Spawn { detail: String },
    #[error("probe failed: {detail}")]
    Failed { detail: String },
    #[error("model-scoped launch-control observation was incomplete")]
    ModelControlsIncomplete,
    /// The probe thread ended without sending an outcome — it panicked, or the
    /// runtime could not be built. Distinct from `Failed` because it means the
    /// engine learned nothing about the harness.
    #[error("probe runner vanished before reporting an outcome")]
    RunnerVanished,
}

impl ProbeError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Materialize(_) => "materialization_failed",
            Self::Timeout => "timeout",
            Self::Cancelled => "cancelled",
            Self::Spawn { .. } => Self::CODE_SPAWN,
            Self::Failed { .. } => "probe_failed",
            Self::ModelControlsIncomplete => "model_controls_incomplete",
            Self::RunnerVanished => "runner_vanished",
        }
    }

    /// The `lastAttempt.detail` this failure records. Stable strings, because the
    /// status surface and its tests read them. A spawn failure carries the
    /// [`Self::code`] prefix so a surface can name the fast-fail without parsing.
    pub fn detail(&self) -> String {
        match self {
            Self::Timeout => "timeout".to_string(),
            Self::Cancelled => "cancelled".to_string(),
            Self::RunnerVanished => "runner vanished".to_string(),
            Self::Materialize(error) => error.to_string(),
            Self::Spawn { detail } => format!("{}: {detail}", Self::CODE_SPAWN),
            Self::Failed { detail } => detail.clone(),
            Self::ModelControlsIncomplete => "model controls incomplete".to_string(),
        }
    }

    /// The stable machine code for this failure. `Spawn` is the one the fast-fail
    /// path surfaces; the others keep their historical detail strings.
    pub const CODE_SPAWN: &'static str = "spawn_failed";

    /// True when a harness error string names a spawn/exec failure rather than an
    /// in-session probe failure. Matched against the messages
    /// `spawn_agent_process` raises when a binary is missing or will not exec, so
    /// a broken install fast-fails as [`Self::Spawn`] instead of `Failed`.
    ///
    /// COUPLING: these substrings are the literal messages produced in
    /// `live::sessions::driver::process::spawn_agent_process` (`no executable path
    /// for agent`, `spawn agent subprocess: ...`). A `.context(...)` wrapper or a
    /// reword there silently breaks this match — the matching comment on that side
    /// says the same. The forward-safe fix is a typed spawn error; until then this
    /// coupling is the seam to keep honest.
    pub fn is_spawn_failure(message: &str) -> bool {
        message.contains("spawn agent subprocess")
            || message.contains("no executable path for agent")
    }
}

/// Everything one attempt needs, moved onto the probe thread.
///
/// `Debug` is hand-written and omits `material` and `plan`: the material's own
/// `Debug` redacts credentials, but printing it here would still be noise in a
/// failure message, and the plan can be a long model list.
pub struct ProbeRequest {
    pub harness_kind: String,
    pub material: ProbeAuthMaterial,
    pub plan: GatewayModelPlan,
    pub runtime_home: PathBuf,
    pub per_probe_timeout: Duration,
}

/// The model-switch wait handed to `probe_agent`. Claude probes capture the
/// exact control statement under every advertised model; other harnesses keep
/// the no-switch baseline so very large menus do not multiply probe work.
const PROBE_MODEL_SWITCH_TIMEOUT: Duration = Duration::from_secs(1);

impl std::fmt::Debug for ProbeRequest {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ProbeRequest")
            .field("harness_kind", &self.harness_kind)
            .field("state_revision", &self.material.state_revision)
            .field("plan_model_count", &self.plan.models.len())
            .field("per_probe_timeout", &self.per_probe_timeout)
            .finish()
    }
}

/// The `ProbeOptions.auth_context` label a composed runtime probe records.
///
/// `live/sessions/probe.rs` is shared with the central `catalog-probe` CLI, whose
/// snapshots genuinely are per-context; a machine observation is of the whole
/// composed auth world, so it carries this fixed label instead of a context id.
pub const COMPOSED_AUTH_CONTEXT_LABEL: &str = "composed";

/// The seam the engine probes through. Production uses [`AcpProbeRunner`]; tests
/// inject a fake that counts invocations, blocks on a barrier, fails, or hangs —
/// the same way `pr_status_cache` injects `BranchPrFetcher`.
#[async_trait::async_trait]
pub(crate) trait ProbeRunner: Send + Sync {
    async fn run(&self, request: ProbeRequest) -> Result<ProbeSnapshot, ProbeError>;
}

/// The real runner: materialize under a probe-owned scratch, spawn the harness
/// over ACP, tear everything down on the thread that owns it.
pub struct AcpProbeRunner;

#[async_trait::async_trait]
impl ProbeRunner for AcpProbeRunner {
    async fn run(&self, request: ProbeRequest) -> Result<ProbeSnapshot, ProbeError> {
        let Some(agent_kind) = AgentKind::parse(&request.harness_kind) else {
            return Err(ProbeError::Failed {
                detail: format!("unknown harness kind '{}'", request.harness_kind),
            });
        };

        let cancel = CancellationToken::new();
        // Dropping the caller's future fires the token, so a cancelled probe still
        // kills its child and cleans its scratch.
        let guard = cancel.clone().drop_guard();
        let (done_tx, done_rx) = tokio::sync::oneshot::channel();
        let thread_name = format!("launch-options-probe-{}", request.harness_kind);

        std::thread::Builder::new()
            .name(thread_name)
            .spawn(move || {
                // Resolved here, on the dedicated thread, NOT in the async fn's own
                // body: this is a blocking FS scan plus a `node --version`
                // subprocess (readiness/compatibility.rs), and the async fn above
                // runs on a shared tokio worker that every other in-flight probe
                // (and unrelated async work on this runtime) also depends on.
                // Blocking that worker here would stall them all; this thread
                // blocks only itself. Resolved before `materialize_for_probe`
                // below, so a bad agent kind still fails before the scratch is
                // touched — the property this PR's review called out as worth
                // keeping. Unrouted: artifact paths only; a route supplies
                // credentials, not binaries — materialize_for_probe below layers
                // those on separately. Goes through `resolve_agent_unrouted_by_kind`
                // (not a hand-rolled registry lookup) so this call site, the
                // `catalog-probe` CLI, and the probe-materialization test share
                // the one lookup-then-resolve implementation.
                let resolved =
                    match resolve_agent_unrouted_by_kind(&agent_kind, &request.runtime_home) {
                        Ok(resolved) => resolved,
                        Err(error) => {
                            let _ = done_tx.send(Err(ProbeError::Failed {
                                detail: error.to_string(),
                            }));
                            return;
                        }
                    };
                let runtime = match tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                {
                    Ok(runtime) => runtime,
                    Err(error) => {
                        let _ = done_tx.send(Err(ProbeError::Failed {
                            detail: format!("failed to build the probe runtime: {error}"),
                        }));
                        return;
                    }
                };
                let local = tokio::task::LocalSet::new();
                let outcome = local.block_on(&runtime, async move {
                    // PHASE B happens here, so the scratch guard is owned by this
                    // thread for its whole life.
                    let materialized = route_auth::materialize_for_probe(
                        &request.runtime_home,
                        &request.harness_kind,
                        &request.material,
                        &request.plan,
                    )?;
                    let options = ProbeOptions {
                        agent_kind,
                        resolved,
                        auth_context: COMPOSED_AUTH_CONTEXT_LABEL.to_string(),
                        auth_env: materialized.env_set.clone(),
                        auth_env_remove: materialized.env_remove.clone(),
                        // The live home, not the scratch: this is where
                        // `probe_agent` resolves the INSTALL from.
                        runtime_home: request.runtime_home.clone(),
                        workspace_root: Some(materialized.scratch.workspace_root()),
                        model_switch_timeout: PROBE_MODEL_SWITCH_TIMEOUT,
                        // The complete list: `max_models: Some(0)` would truncate
                        // to zero, which is not a way to skip switching.
                        max_models: None,
                        switch_models: request.harness_kind == "claude",
                        // A runtime probe must never burn a user's tokens.
                        send_test_prompt: false,
                    };
                    let result = tokio::select! {
                        outcome = tokio::time::timeout(
                            request.per_probe_timeout,
                            probe_agent(options),
                        ) => match outcome {
                            Ok(Ok(snapshot)) => Ok(snapshot),
                            Ok(Err(error)) => {
                                // A spawn/exec failure fast-fails with a named
                                // code rather than dressing up as a generic probe
                                // failure (ADR FR-2). `spawn_agent_process`
                                // returns immediately on a missing/broken binary,
                                // so this never waited on the timeout.
                                let message = error.to_string();
                                if ProbeError::is_spawn_failure(&message) {
                                    Err(ProbeError::Spawn { detail: message })
                                } else {
                                    Err(ProbeError::Failed { detail: message })
                                }
                            }
                            Err(_) => Err(ProbeError::Timeout),
                        },
                        _ = cancel.cancelled() => Err(ProbeError::Cancelled),
                    };
                    // `materialized` — and its ProbeScratch — drops HERE, after
                    // probe_agent's own teardown or after the select arm dropped
                    // its future (which on THIS runtime does drop the Child and
                    // fire kill_on_drop, because the Child lives here).
                    drop(materialized);
                    result
                });
                let _ = done_tx.send(outcome);
            })
            .map_err(|error| ProbeError::Failed {
                detail: format!("failed to spawn the probe thread: {error}"),
            })?;

        let outcome = done_rx.await.unwrap_or(Err(ProbeError::RunnerVanished));
        // Disarm only after the thread reported: an early disarm would leave a
        // cancelled caller unable to stop the child.
        drop(guard);
        outcome
    }
}
