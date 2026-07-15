//! The one workflow execution task (spec workflow-run-control §6.2): every
//! durable CAS boundary, session creation + binding, startup, v2 effort
//! application, and the single prompt-dispatch classification site — with the
//! per-run gate acquisitions exactly as frozen. Split out of `runtime.rs` per
//! the domains growth rules; `WorkflowRunRuntime` stays the sole facade.

use std::sync::Arc;
use std::time::Duration;

use anyharness_contract::v1::ConfigApplyState;

use crate::domains::sessions::admission::{SessionMutationAdmission, SessionMutationSource};
use crate::domains::sessions::runtime::{InternalSessionCreateInput, SessionRuntime};
use crate::domains::workflows::control::WorkflowRunGates;
use crate::domains::workflows::dispatch::{
    apply_prompt_dispatch_outcome, blocking_bool, guarded_fail, map_create_error, ExecutionAbort,
};
use crate::domains::workflows::model::WorkflowRunFailureCode;
use crate::domains::workflows::service::{WorkflowExecutionPlan, WorkflowRunService};
use crate::domains::workspaces::operation_gate::{WorkspaceOperationGate, WorkspaceOperationKind};
use crate::origin::OriginContext;

pub(super) fn effort_apply_allows_step(state: Option<&ConfigApplyState>) -> bool {
    matches!(state, Some(ConfigApplyState::Applied))
}

const WORKFLOW_EFFORT_APPLY_TIMEOUT: Duration = Duration::from_secs(45);

/// The one execution task: one outer `Result` boundary, one guarded failure
/// write. No `unwrap`/`expect`.
#[tracing::instrument(skip_all, fields(run_id = %plan.run_id, workspace_id = %plan.workspace_id))]
pub(crate) async fn execute(
    service: Arc<WorkflowRunService>,
    session_runtime: Arc<SessionRuntime>,
    operation_gate: Arc<WorkspaceOperationGate>,
    gates: Arc<WorkflowRunGates>,
    admission: Arc<SessionMutationAdmission>,
    plan: WorkflowExecutionPlan,
) {
    let run_id = plan.run_id.clone();
    match run_execution(
        &service,
        &session_runtime,
        &operation_gate,
        &gates,
        &admission,
        plan,
    )
    .await
    {
        Ok(()) => {}
        Err(ExecutionAbort::Fail(code)) => {
            // Every classified execution-failure terminalization uses the
            // same run gate (spec §6.2); with a bound session, the terminal
            // CAS additionally holds the session mutation permit (spec 2b,
            // canonical order run gate -> permit). Pre-binding failures have
            // no controlled session and terminalize under the gate alone.
            match gates.slot(&run_id) {
                Ok(gate) => {
                    let _guard = gate.lock_owned().await;
                    let _permit = acquire_bound_session_permit(&service, &admission, &run_id).await;
                    guarded_fail(&service, &run_id, code).await;
                }
                Err(_poisoned) => {
                    tracing::error!(
                        run_id = %run_id,
                        "workflow run gate unavailable for failure terminalization"
                    );
                    guarded_fail(&service, &run_id, code).await;
                }
            }
        }
        Err(ExecutionAbort::Infra) => {
            // Already logged with correlation IDs only. Rows stay nonterminal;
            // the next startup fence resolves them. Never claim completion.
        }
    }
}

async fn run_execution(
    service: &Arc<WorkflowRunService>,
    session_runtime: &Arc<SessionRuntime>,
    operation_gate: &Arc<WorkspaceOperationGate>,
    gates: &Arc<WorkflowRunGates>,
    admission: &Arc<SessionMutationAdmission>,
    plan: WorkflowExecutionPlan,
) -> Result<(), ExecutionAbort> {
    let run_id = plan.run_id.clone();

    // 1. accepted -> running, under the run gate (spec §6.2). Released while
    // acquiring the workspace lease so cancellation is never blocked on it.
    {
        let _gate = acquire_run_gate(gates, &run_id).await?;
        if !blocking_bool(&run_id, "begin_run", {
            let service = service.clone();
            let run_id = run_id.clone();
            move || service.begin_run(&run_id)
        })
        .await?
        {
            // The run is no longer accepted (cancelled/fenced concurrently);
            // this task does not own the transition.
            return Ok(());
        }
    }

    // 2. Hold the shared SessionStart lease through prompt acceptance. It lives
    // on this async task stack and is never moved into blocking work.
    let _lease = operation_gate
        .acquire_shared(&plan.workspace_id, WorkspaceOperationKind::SessionStart)
        .await;

    #[cfg(test)]
    test_barriers::at_session_start_lease(&run_id).await;

    // 3+4. Reacquire the gate: recheck nonterminal/uncancelled state, then
    // hold through durable session creation plus session_id binding. If
    // cancellation won the recheck, no session is created; if creation wins,
    // its binding attempt happens before cancellation can terminalize the
    // pending step.
    let session = {
        let _gate = acquire_run_gate(gates, &run_id).await?;
        if !blocking_bool(&run_id, "recheck_before_create", {
            let service = service.clone();
            let run_id = run_id.clone();
            move || service.run_in_flight(&run_id)
        })
        .await?
        {
            return Ok(());
        }

        // Ruling 2b-1: preselect the session id and reserve its mutation
        // gate BEFORE the row exists, inside the held run gate (canonical
        // order run gate -> permit). Foreign callers racing this id wait on
        // the permit and then observe the bound controller; there is no
        // externally writable gap. The permit is held through creation and
        // binding and released only after binding commits (scope end).
        let preselected_session_id = uuid::Uuid::new_v4().to_string();
        let workflow_source = SessionMutationSource::workflow_run(&run_id);
        let _creation_permit = match admission
            .reserve_new_session(&preselected_session_id, &workflow_source)
            .await
        {
            Ok(permit) => permit,
            Err(_conflict) => {
                tracing::error!(
                    run_id = %run_id,
                    "workflow session reservation infrastructure failed"
                );
                return Err(ExecutionAbort::Infra);
            }
        };

        let create_input = InternalSessionCreateInput {
            workspace_id: plan.workspace_id.clone(),
            agent_kind: plan.agent_kind.clone(),
            model_id: plan.model_id.clone(),
            mode_id: plan.mode_id.clone(),
            origin: OriginContext::system_local_runtime(),
            preselected_session_id: Some(preselected_session_id.clone()),
        };
        let session = {
            let session_runtime = session_runtime.clone();
            let run_id_for_log = run_id.clone();
            let joined = tokio::task::spawn_blocking(move || {
                session_runtime.create_persisted_internal_session(create_input)
            })
            .await;
            match joined {
                Ok(Ok(record)) => record,
                Ok(Err(error)) => return Err(ExecutionAbort::Fail(map_create_error(&error))),
                Err(join_error) => {
                    tracing::error!(
                        run_id = %run_id_for_log,
                        error = %join_error,
                        "workflow session creation task join failed"
                    );
                    return Err(ExecutionAbort::Fail(
                        WorkflowRunFailureCode::SessionCreateFailed,
                    ));
                }
            }
        };

        #[cfg(test)]
        test_barriers::at_reserved(&run_id, &session.id).await;

        // Persist session_id BEFORE startup, still under the gate. A `false`
        // here means cancellation terminalized the run after creation won; the
        // created session remains as ordinary retained correlation evidence.
        if !blocking_bool(&run_id, "bind_session", {
            let service = service.clone();
            let run_id = run_id.clone();
            let session_id = session.id.clone();
            move || service.bind_session(&run_id, &session_id)
        })
        .await?
        {
            return Ok(());
        }
        session
    };
    let session_id = session.id.clone();

    #[cfg(test)]
    test_barriers::at_session_bound(&run_id, &session_id).await;

    // 5. Start the persisted session OUTSIDE the gate so a cancel request is
    // not blocked for the full startup duration.
    if let Err(error) = session_runtime.start_persisted_session(&session).await {
        tracing::warn!(
            run_id = %run_id,
            session_id = %session_id,
            "workflow session startup failed"
        );
        let _ = error;
        return Err(ExecutionAbort::Fail(
            WorkflowRunFailureCode::SessionStartFailed,
        ));
    }

    // 6. Apply schema-v2 effort after startup, also outside the gate.
    if let Some(effort) = &plan.effort_config {
        let applied = tokio::time::timeout(
            WORKFLOW_EFFORT_APPLY_TIMEOUT,
            session_runtime.set_live_session_config_option(
                &session_id,
                &effort.config_id,
                &effort.value,
            ),
        )
        .await;
        let apply_state = applied
            .as_ref()
            .ok()
            .and_then(|result| result.as_ref().ok())
            .map(|(_, _, state)| state);
        if !effort_apply_allows_step(apply_state) {
            tracing::warn!(
                run_id = %run_id,
                session_id = %session_id,
                timed_out = applied.is_err(),
                "workflow session effort configuration was not applied"
            );
            return Err(ExecutionAbort::Fail(
                WorkflowRunFailureCode::SessionConfigApplyFailed,
            ));
        }
    }

    // 7+8. Reacquire the gate for the final uncancelled CAS, pending ->
    // running, prompt acceptance at the single dispatch site, turn-id
    // persistence, and any prompt-dispatch failure terminalization. If
    // cancellation won during startup/effort it terminalized the pending step;
    // the recheck observes that and sends no prompt.
    {
        let _gate = acquire_run_gate(gates, &run_id).await?;
        let in_flight = blocking_bool(&run_id, "recheck_before_dispatch", {
            let service = service.clone();
            let run_id = run_id.clone();
            move || service.run_in_flight(&run_id)
        })
        .await?;
        #[cfg(test)]
        test_barriers::at_recheck(&run_id, in_flight);
        if !in_flight {
            return Ok(());
        }
        if !blocking_bool(&run_id, "begin_step", {
            let service = service.clone();
            let run_id = run_id.clone();
            move || service.begin_step(&run_id)
        })
        .await?
        {
            return Ok(());
        }

        #[cfg(test)]
        test_barriers::at_pre_dispatch(&run_id).await;

        // Dispatch the one rendered prompt with the deterministic prompt id.
        // Ambiguity rule (symmetric with "never claim completion"): a LOST
        // acknowledgement is never a failure claim — the actor may be running
        // the turn. The step stays running with a null turn id; the extension
        // terminalizes it if the turn ran, and the startup fence resolves it
        // if not. Only a verifiably failed dispatch persists
        // `prompt_dispatch_failed`, terminalized under this same gate hold
        // (spec §6.2) rather than at the outer `execute` boundary.
        let acceptance = session_runtime
            .send_text_prompt_with_id(
                &session_id,
                plan.rendered_prompt.clone(),
                plan.prompt_id.clone(),
            )
            .await;
        match apply_prompt_dispatch_outcome(service, &run_id, &session_id, acceptance).await {
            Ok(()) => {}
            Err(ExecutionAbort::Fail(code)) => {
                guarded_fail(service, &run_id, code).await;
                return Ok(());
            }
            Err(ExecutionAbort::Infra) => return Err(ExecutionAbort::Infra),
        }
    }

    // 9. Drop the lease (on scope exit) — completion arrives via the extension.
    Ok(())
}

/// Merge-gated ordering barriers (review PR1196-PROOF-01): let a test park the
/// REAL execution task at two frozen points — after the session is bound (so a
/// scripted live handle can be registered before startup) and under the final
/// dispatch gate right before prompt acceptance. Keyed per run id; absent keys
/// cost one mutex lookup and change nothing. Test-only by construction.
#[cfg(test)]
pub(crate) mod test_barriers {
    use std::collections::HashMap;
    use std::sync::Mutex as StdMutex;

    use tokio::sync::oneshot;

    #[derive(Default)]
    pub(crate) struct ExecutionBarrier {
        /// Fired after the shared `SessionStart` lease is held, BEFORE session
        /// creation (PR1227-WORKSPACE-FENCE-01 window: a destructive path's
        /// up-front admission snapshot can run here, before this run's session
        /// exists).
        pub(crate) session_start_lease_tx: Option<oneshot::Sender<()>>,
        /// Awaited (still holding the shared `SessionStart` lease) before
        /// session creation when present.
        pub(crate) resume_create_rx: Option<oneshot::Receiver<()>>,
        /// Fired with the preselected session id after the reservation
        /// permit is held and the durable session row exists, BEFORE binding
        /// (spec 2b creation-race window).
        pub(crate) reserved_tx: Option<oneshot::Sender<String>>,
        /// Awaited (still holding gate + reservation permit) before binding
        /// when present.
        pub(crate) resume_bind_rx: Option<oneshot::Receiver<()>>,
        /// Fired with the bound session id after `bind_session`, before
        /// startup (step 5).
        pub(crate) session_bound_tx: Option<oneshot::Sender<String>>,
        /// Awaited before proceeding to startup when present.
        pub(crate) resume_startup_rx: Option<oneshot::Receiver<()>>,
        /// Fired with the boolean result of the production post-effort
        /// `run_in_flight` recheck, at its exact evaluation site under the
        /// final gate (review PR1196-PROOF-01B: the recheck's traversal and
        /// result are observable, not inferred from the following CAS).
        pub(crate) recheck_tx: Option<oneshot::Sender<bool>>,
        /// Fired under the held final gate, after `begin_step`, before the
        /// real prompt dispatch.
        pub(crate) pre_dispatch_tx: Option<oneshot::Sender<()>>,
        /// Awaited under the held final gate before dispatching when present.
        pub(crate) resume_dispatch_rx: Option<oneshot::Receiver<()>>,
        /// Fired by `cancel_workflow_run` immediately before it awaits this
        /// run's gate (review PR1196-PROOF-01C: proves the cancel request has
        /// reached the production gate before a parked dispatch releases).
        pub(crate) cancel_gate_tx: Option<oneshot::Sender<()>>,
    }

    impl ExecutionBarrier {
        fn is_spent(&self) -> bool {
            self.session_start_lease_tx.is_none()
                && self.resume_create_rx.is_none()
                && self.reserved_tx.is_none()
                && self.resume_bind_rx.is_none()
                && self.session_bound_tx.is_none()
                && self.resume_startup_rx.is_none()
                && self.recheck_tx.is_none()
                && self.pre_dispatch_tx.is_none()
                && self.resume_dispatch_rx.is_none()
                && self.cancel_gate_tx.is_none()
        }
    }

    static BARRIERS: StdMutex<Option<HashMap<String, ExecutionBarrier>>> = StdMutex::new(None);

    pub(crate) fn install(run_id: &str, barrier: ExecutionBarrier) {
        BARRIERS
            .lock()
            .expect("barrier lock")
            .get_or_insert_with(HashMap::new)
            .insert(run_id.to_string(), barrier);
    }

    /// Drop any leftover barrier state for `run_id` (test teardown; keeps the
    /// static map free of abandoned entries).
    pub(crate) fn clear(run_id: &str) {
        if let Some(map) = BARRIERS.lock().expect("barrier lock").as_mut() {
            map.remove(run_id);
        }
    }

    fn take(run_id: &str) -> Option<ExecutionBarrier> {
        BARRIERS
            .lock()
            .expect("barrier lock")
            .as_mut()?
            .remove(run_id)
    }

    /// Reinsert only barriers that still hold unconsumed endpoints; spent
    /// entries are dropped so the map never accumulates.
    fn put_back(run_id: &str, barrier: ExecutionBarrier) {
        if barrier.is_spent() {
            return;
        }
        BARRIERS
            .lock()
            .expect("barrier lock")
            .get_or_insert_with(HashMap::new)
            .insert(run_id.to_string(), barrier);
    }

    pub(super) async fn at_session_start_lease(run_id: &str) {
        let Some(mut barrier) = take(run_id) else {
            return;
        };
        if let Some(tx) = barrier.session_start_lease_tx.take() {
            let _ = tx.send(());
        }
        let resume = barrier.resume_create_rx.take();
        put_back(run_id, barrier);
        if let Some(rx) = resume {
            let _ = rx.await;
        }
    }

    pub(super) async fn at_reserved(run_id: &str, session_id: &str) {
        let Some(mut barrier) = take(run_id) else {
            return;
        };
        if let Some(tx) = barrier.reserved_tx.take() {
            let _ = tx.send(session_id.to_string());
        }
        let resume = barrier.resume_bind_rx.take();
        put_back(run_id, barrier);
        if let Some(rx) = resume {
            let _ = rx.await;
        }
    }

    pub(super) async fn at_session_bound(run_id: &str, session_id: &str) {
        let Some(mut barrier) = take(run_id) else {
            return;
        };
        if let Some(tx) = barrier.session_bound_tx.take() {
            let _ = tx.send(session_id.to_string());
        }
        let resume = barrier.resume_startup_rx.take();
        put_back(run_id, barrier);
        if let Some(rx) = resume {
            let _ = rx.await;
        }
    }

    pub(super) fn at_recheck(run_id: &str, in_flight: bool) {
        let Some(mut barrier) = take(run_id) else {
            return;
        };
        if let Some(tx) = barrier.recheck_tx.take() {
            let _ = tx.send(in_flight);
        }
        put_back(run_id, barrier);
    }

    pub(super) async fn at_pre_dispatch(run_id: &str) {
        let Some(mut barrier) = take(run_id) else {
            return;
        };
        if let Some(tx) = barrier.pre_dispatch_tx.take() {
            let _ = tx.send(());
        }
        let resume = barrier.resume_dispatch_rx.take();
        put_back(run_id, barrier);
        if let Some(rx) = resume {
            let _ = rx.await;
        }
    }

    /// Called from the cancellation path (not the executor): signals that the
    /// cancel request is about to await this run's production gate.
    pub(crate) fn at_cancel_gate(run_id: &str) {
        let Some(mut barrier) = take(run_id) else {
            return;
        };
        if let Some(tx) = barrier.cancel_gate_tx.take() {
            let _ = tx.send(());
        }
        put_back(run_id, barrier);
    }
}

/// Acquire the per-run gate on the execution path; a poisoned slot map is an
/// infrastructure failure (logged, rows left nonterminal for fencing).
async fn acquire_run_gate(
    gates: &Arc<WorkflowRunGates>,
    run_id: &str,
) -> Result<tokio::sync::OwnedMutexGuard<()>, ExecutionAbort> {
    match gates.slot(run_id) {
        Ok(gate) => Ok(gate.lock_owned().await),
        Err(_poisoned) => {
            tracing::error!(run_id = %run_id, "workflow run gate unavailable");
            Err(ExecutionAbort::Infra)
        }
    }
}

/// With a bound session, terminal workflow CAS paths hold that session's
/// mutation permit (spec 2b); without one there is no controlled session and
/// the run gate alone suffices. Permit-acquisition infrastructure failure
/// degrades to gate-only terminalization: a missed serialization window is
/// recoverable by fencing, an unterminalized run is worse.
pub(crate) async fn acquire_bound_session_permit(
    service: &Arc<WorkflowRunService>,
    admission: &Arc<SessionMutationAdmission>,
    run_id: &str,
) -> Option<crate::domains::sessions::admission::SessionMutationPermit> {
    let lookup_service = service.clone();
    let lookup_run_id = run_id.to_string();
    let session_id = tokio::task::spawn_blocking(move || lookup_service.get(&lookup_run_id))
        .await
        .ok()?
        .ok()??
        .run
        .session_id?;
    match admission
        .acquire(
            &session_id,
            crate::domains::sessions::admission::SessionMutationKind::WorkflowTerminal,
            &SessionMutationSource::workflow_run(run_id),
        )
        .await
    {
        Ok(permit) => Some(permit),
        Err(_conflict) => {
            tracing::error!(
                run_id = %run_id,
                session_id = %session_id,
                "session permit unavailable for terminal workflow CAS; proceeding under run gate alone"
            );
            None
        }
    }
}
