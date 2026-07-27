//! The runner: one probe attempt, on a dedicated thread that owns both the
//! harness child and the scratch root.
//!
//! `probe_agent` requires a `LocalSet` (the ACP connection uses `spawn_local`, so
//! a bare `tokio::spawn` will not do) and carries no timeout of its own, so "the
//! reconciler bounds each probe" (model-catalog.md). The shape is the
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

use crate::domains::agents::model::AgentKind;
use crate::domains::agents::route_auth::{
    self, GatewayModelPlan, ProbeAuthMaterial, RouteAuthError,
};
use crate::live::sessions::probe::{probe_agent, ProbeOptions, ProbeSnapshot};

#[derive(Debug, thiserror::Error)]
pub enum ProbeError {
    #[error("agent-auth materialization for the probe failed: {0}")]
    Materialize(#[from] RouteAuthError),
    #[error("probe timed out")]
    Timeout,
    #[error("probe was cancelled")]
    Cancelled,
    #[error("probe failed: {detail}")]
    Failed { detail: String },
    /// The probe thread ended without sending an outcome — it panicked, or the
    /// runtime could not be built. Distinct from `Failed` because it means the
    /// engine learned nothing about the harness.
    #[error("probe runner vanished before reporting an outcome")]
    RunnerVanished,
}

impl ProbeError {
    /// The `lastAttempt.detail` this failure records. Stable strings, because the
    /// status surface and its tests read them.
    pub fn detail(&self) -> String {
        match self {
            Self::Timeout => "timeout".to_string(),
            Self::Cancelled => "cancelled".to_string(),
            Self::RunnerVanished => "runner vanished".to_string(),
            Self::Materialize(error) => error.to_string(),
            Self::Failed { detail } => detail.clone(),
        }
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
    pub model_switch_timeout: Duration,
}

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
pub trait ProbeRunner: Send + Sync {
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
        let thread_name = format!("model-snapshot-probe-{}", request.harness_kind);

        std::thread::Builder::new()
            .name(thread_name)
            .spawn(move || {
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
                        auth_context: COMPOSED_AUTH_CONTEXT_LABEL.to_string(),
                        auth_env: materialized.env_set.clone(),
                        auth_env_remove: materialized.env_remove.clone(),
                        // The live home, not the scratch: this is where
                        // `probe_agent` resolves the INSTALL from.
                        runtime_home: request.runtime_home.clone(),
                        workspace_root: Some(materialized.scratch.workspace_root()),
                        model_switch_timeout: request.model_switch_timeout,
                        // The complete list: `max_models: Some(0)` would truncate
                        // to zero, which is not a way to skip switching.
                        max_models: None,
                        switch_models: false,
                        // A runtime probe must never burn a user's tokens.
                        send_test_prompt: false,
                    };
                    let result = tokio::select! {
                        outcome = tokio::time::timeout(
                            request.per_probe_timeout,
                            probe_agent(options),
                        ) => match outcome {
                            Ok(Ok(snapshot)) => Ok(snapshot),
                            Ok(Err(error)) => Err(ProbeError::Failed {
                                detail: error.to_string(),
                            }),
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
