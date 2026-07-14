//! The sole async workflow execution facade. `WorkflowRunRuntime` accepts
//! before any effect, spawns exactly one task for a freshly `Created` run, owns
//! the shared workspace-operation lease and the concrete session sequence, and
//! converts every post-acceptance error into one guarded durable failure
//! attempt. Every synchronous service/store call from async code runs on the
//! blocking pool; no lease, transaction, or connection ever survives an
//! unrelated await.

use std::collections::HashMap;
use std::sync::{Arc, Mutex as StdMutex, Weak};
use std::time::Duration;

use tokio::runtime::Handle;
use tokio::sync::Mutex as AsyncMutex;

use anyharness_contract::v1::ConfigApplyState;

use crate::domains::sessions::runtime::{
    CreateAndStartSessionError, InternalSessionCreateError, InternalSessionCreateInput,
    SendPromptError, SendPromptOutcome, SessionRuntime,
};
use crate::domains::workflows::model::{
    VersionedPutWorkflowRunInput, WorkflowResolvedPlanV2, WorkflowRunFailureCode,
};
use crate::domains::workflows::resolution::{resolve_workflow_target, WorkflowResolutionError};
use crate::domains::workflows::service::{
    AcceptOutcome, AcceptV2Outcome, InspectV2Outcome, VersionedWorkflowRunView,
    WorkflowAcceptError, WorkflowExecutionPlan, WorkflowRunService, WorkflowRunValidationError,
    WorkflowServiceError,
};
use crate::domains::workspaces::access_gate::{WorkspaceAccessError, WorkspaceAccessGate};
use crate::domains::workspaces::operation_gate::{WorkspaceOperationGate, WorkspaceOperationKind};
use crate::origin::OriginContext;

/// The successful PUT result: whether the invocation was newly created (201) or
/// exactly replayed (200), with the durable view either way.
#[derive(Debug)]
pub enum WorkflowPutSuccess {
    Created(VersionedWorkflowRunView),
    Replay(VersionedWorkflowRunView),
}

/// The PUT failure arm.
#[derive(Debug)]
pub enum WorkflowPutError {
    Invalid(WorkflowRunValidationError),
    Conflict,
    WorkspaceAccess(WorkspaceAccessError),
    TargetUnresolvable(WorkflowResolutionError),
    Store(WorkflowServiceError),
    /// Blocking-pool join failure (task panic/cancel).
    Internal(anyhow::Error),
}

/// The GET failure arm.
#[derive(Debug)]
pub enum WorkflowGetError {
    /// The path `runId` is not a canonical UUID (spec §3: coded 400, like PUT).
    InvalidRunId(WorkflowRunValidationError),
    Store(WorkflowServiceError),
    Internal(anyhow::Error),
}

/// How execution stopped when it did not reach the extension-driven completion.
enum ExecutionAbort {
    /// A classified effect failure: attempt one guarded durable failure write.
    Fail(WorkflowRunFailureCode),
    /// A store/join infrastructure failure, already logged. Leave rows
    /// nonterminal and let the next startup fence handle them, mirroring the
    /// terminal-write-failure rule.
    Infra,
}

pub struct WorkflowRunRuntime {
    service: Arc<WorkflowRunService>,
    session_runtime: Arc<SessionRuntime>,
    operation_gate: Arc<WorkspaceOperationGate>,
    access_gate: Arc<WorkspaceAccessGate>,
    accept_gates: Arc<StdMutex<HashMap<String, Weak<AsyncMutex<()>>>>>,
    main_handle: Handle,
}

fn workflow_accept_gate_slot(
    gates: &StdMutex<HashMap<String, Weak<AsyncMutex<()>>>>,
    run_id: &str,
) -> Result<Arc<AsyncMutex<()>>, WorkflowPutError> {
    let mut gates = gates.lock().map_err(|_| {
        WorkflowPutError::Internal(anyhow::anyhow!("workflow run gate lock poisoned"))
    })?;
    gates.retain(|_, gate| gate.strong_count() > 0);
    if let Some(gate) = gates.get(run_id).and_then(Weak::upgrade) {
        return Ok(gate);
    }

    let gate = Arc::new(AsyncMutex::new(()));
    gates.insert(run_id.to_string(), Arc::downgrade(&gate));
    Ok(gate)
}

fn effort_apply_allows_step(state: Option<&ConfigApplyState>) -> bool {
    matches!(state, Some(ConfigApplyState::Applied))
}

const WORKFLOW_EFFORT_APPLY_TIMEOUT: Duration = Duration::from_secs(45);

impl WorkflowRunRuntime {
    pub fn new(
        service: Arc<WorkflowRunService>,
        session_runtime: Arc<SessionRuntime>,
        operation_gate: Arc<WorkspaceOperationGate>,
        access_gate: Arc<WorkspaceAccessGate>,
        main_handle: Handle,
    ) -> Self {
        Self {
            service,
            session_runtime,
            operation_gate,
            access_gate,
            accept_gates: Arc::new(StdMutex::new(HashMap::new())),
            main_handle,
        }
    }

    /// Accept a PUT. Only a fresh `Created` starts execution; replay returns the
    /// current view without any effect; conflict is a typed error.
    ///
    /// Cancellation safety (review C2A-REV-01): the accept + Created decision +
    /// execution scheduling all run inside ONE task detached onto the main
    /// runtime; this method merely awaits its JoinHandle. Dropping the HTTP
    /// future mid-request detaches the awaiter but never cancels the
    /// acceptance→execution handoff, so a committed `Created` can never orphan
    /// as `accepted`.
    #[tracing::instrument(skip_all, fields(run_id = %run_id))]
    pub async fn put(
        &self,
        run_id: String,
        input: VersionedPutWorkflowRunInput,
    ) -> Result<WorkflowPutSuccess, WorkflowPutError> {
        let service = self.service.clone();
        let session_runtime = self.session_runtime.clone();
        let operation_gate = self.operation_gate.clone();
        let access_gate = self.access_gate.clone();
        let accept_gates = self.accept_gates.clone();
        let execution_handle = self.main_handle.clone();

        let handoff = self.main_handle.spawn(async move {
            match input {
                VersionedPutWorkflowRunInput::V1(input) => {
                    let run_gate = workflow_accept_gate_slot(&accept_gates, &run_id)?;
                    let _run_guard = run_gate.lock_owned().await;
                    let accept_service = service.clone();
                    let accept_run_id = run_id.clone();
                    let outcome = tokio::task::spawn_blocking(move || {
                        accept_service.accept(&accept_run_id, input)
                    })
                    .await
                    .map_err(|error| WorkflowPutError::Internal(error.into()))?;

                    match outcome {
                        Ok(AcceptOutcome::Created { plan, view }) => {
                            execution_handle.spawn(async move {
                                execute(service, session_runtime, operation_gate, plan).await;
                            });
                            Ok(WorkflowPutSuccess::Created(VersionedWorkflowRunView::V1(
                                view,
                            )))
                        }
                        Ok(AcceptOutcome::ExactReplay(view)) => Ok(WorkflowPutSuccess::Replay(
                            VersionedWorkflowRunView::V1(view),
                        )),
                        Ok(AcceptOutcome::Conflict) => Err(WorkflowPutError::Conflict),
                        Err(WorkflowAcceptError::Invalid(error)) => {
                            Err(WorkflowPutError::Invalid(error))
                        }
                        Err(WorkflowAcceptError::Store(error)) => {
                            Err(WorkflowPutError::Store(error))
                        }
                    }
                }
                VersionedPutWorkflowRunInput::V2(input) => {
                    let prepare_service = service.clone();
                    let prepare_run_id = run_id.clone();
                    let prepared = tokio::task::spawn_blocking(move || {
                        prepare_service.prepare_v2(&prepare_run_id, input)
                    })
                    .await
                    .map_err(|error| WorkflowPutError::Internal(error.into()))?
                    .map_err(WorkflowPutError::Invalid)?;

                    // SQLite remains the replay authority. This narrow keyed
                    // gate only prevents same-process racers from both
                    // performing target lookup before one durable winner is
                    // visible to the other.
                    let run_gate = workflow_accept_gate_slot(&accept_gates, &run_id)?;
                    let _run_guard = run_gate.lock_owned().await;

                    let inspect_service = service.clone();
                    let prepared_for_inspect = prepared.clone();
                    let inspected = tokio::task::spawn_blocking(move || {
                        inspect_service.inspect_v2(prepared_for_inspect)
                    })
                    .await
                    .map_err(|error| WorkflowPutError::Internal(error.into()))?
                    .map_err(WorkflowPutError::Store)?;
                    let prepared = match inspected {
                        InspectV2Outcome::Missing(_) => prepared,
                        InspectV2Outcome::ExactReplay(view) => {
                            return Ok(WorkflowPutSuccess::Replay(VersionedWorkflowRunView::V2(
                                view,
                            )));
                        }
                        InspectV2Outcome::Conflict => {
                            return Err(WorkflowPutError::Conflict);
                        }
                    };

                    let workspace_id = prepared.source.workspace_id.clone();
                    let harness = prepared.source.definition.stages[0].harness_config.clone();
                    let access_workspace_id = workspace_id.clone();
                    tokio::task::spawn_blocking(move || {
                        access_gate.assert_can_mutate_for_workspace(&access_workspace_id)
                    })
                    .await
                    .map_err(|error| WorkflowPutError::Internal(error.into()))?
                    .map_err(WorkflowPutError::WorkspaceAccess)?;

                    let launch_runtime = session_runtime.clone();
                    let launch_workspace_id = workspace_id.clone();
                    let options = tokio::task::spawn_blocking(move || {
                        launch_runtime.resolved_workspace_launch_options(&launch_workspace_id)
                    })
                    .await
                    .map_err(|error| WorkflowPutError::Internal(error.into()))?
                    .map_err(|_error| {
                        WorkflowPutError::Internal(anyhow::anyhow!(
                            "workflow launch-options lookup failed"
                        ))
                    })?;
                    let target = resolve_workflow_target(&options, &harness)
                        .map_err(WorkflowPutError::TargetUnresolvable)?;

                    let render_service = service.clone();
                    let prepared_for_render = prepared.clone();
                    let rendered_prompt = tokio::task::spawn_blocking(move || {
                        render_service.render_v2(&prepared_for_render)
                    })
                    .await
                    .map_err(|error| WorkflowPutError::Internal(error.into()))?
                    .map_err(WorkflowPutError::Invalid)?;
                    let resolved = WorkflowResolvedPlanV2 {
                        workspace_id,
                        agent_kind: target.agent_kind,
                        model_id: target.model_id,
                        mode_id: target.mode_id,
                        effort_config: target.effort_config,
                        rendered_prompt,
                        prompt_id: prepared.prompt_id.clone(),
                    };

                    let accept_service = service.clone();
                    let accepted = tokio::task::spawn_blocking(move || {
                        accept_service.accept_v2(prepared, resolved)
                    })
                    .await
                    .map_err(|error| WorkflowPutError::Internal(error.into()))?
                    .map_err(WorkflowPutError::Store)?;
                    match accepted {
                        AcceptV2Outcome::Created { plan, view } => {
                            let execution_plan = WorkflowExecutionPlan {
                                run_id: view.run.id.clone(),
                                workspace_id: plan.workspace_id.clone(),
                                agent_kind: plan.agent_kind.clone(),
                                model_id: Some(plan.model_id.clone()),
                                mode_id: Some(plan.mode_id.clone()),
                                effort_config: plan.effort_config.clone(),
                                rendered_prompt: plan.rendered_prompt.clone(),
                                prompt_id: plan.prompt_id.clone(),
                            };
                            execution_handle.spawn(async move {
                                execute(service, session_runtime, operation_gate, execution_plan)
                                    .await;
                            });
                            Ok(WorkflowPutSuccess::Created(VersionedWorkflowRunView::V2(
                                view,
                            )))
                        }
                        AcceptV2Outcome::ExactReplay(view) => Ok(WorkflowPutSuccess::Replay(
                            VersionedWorkflowRunView::V2(view),
                        )),
                        AcceptV2Outcome::Conflict => Err(WorkflowPutError::Conflict),
                    }
                }
            }
        });

        handoff
            .await
            .map_err(|error| WorkflowPutError::Internal(error.into()))?
    }

    /// GET the durable view. A non-canonical `runId` is a typed 400, not a 404.
    #[tracing::instrument(skip_all, fields(run_id = %run_id))]
    pub async fn get(
        &self,
        run_id: String,
    ) -> Result<Option<VersionedWorkflowRunView>, WorkflowGetError> {
        if let Err(error) = crate::domains::workflows::service::validate_run_id(&run_id) {
            return Err(WorkflowGetError::InvalidRunId(error));
        }
        let service = self.service.clone();
        tokio::task::spawn_blocking(move || service.get_versioned(&run_id))
            .await
            .map_err(|error| WorkflowGetError::Internal(error.into()))?
            .map_err(WorkflowGetError::Store)
    }
}

/// The one execution task: one outer `Result` boundary, one guarded failure
/// write. No `unwrap`/`expect`.
#[tracing::instrument(skip_all, fields(run_id = %plan.run_id, workspace_id = %plan.workspace_id))]
async fn execute(
    service: Arc<WorkflowRunService>,
    session_runtime: Arc<SessionRuntime>,
    operation_gate: Arc<WorkspaceOperationGate>,
    plan: WorkflowExecutionPlan,
) {
    let run_id = plan.run_id.clone();
    match run_execution(&service, &session_runtime, &operation_gate, plan).await {
        Ok(()) => {}
        Err(ExecutionAbort::Fail(code)) => {
            guarded_fail(&service, &run_id, code).await;
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
    plan: WorkflowExecutionPlan,
) -> Result<(), ExecutionAbort> {
    let run_id = plan.run_id.clone();

    // 1. accepted -> running.
    if !blocking_bool(&run_id, "begin_run", {
        let service = service.clone();
        let run_id = run_id.clone();
        move || service.begin_run(&run_id)
    })
    .await?
    {
        // The run is no longer accepted (concurrently fenced/failed); this task
        // does not own the transition.
        return Ok(());
    }

    // 2. Hold the shared SessionStart lease through prompt acceptance. It lives
    // on this async task stack and is never moved into blocking work.
    let _lease = operation_gate
        .acquire_shared(&plan.workspace_id, WorkspaceOperationKind::SessionStart)
        .await;

    // 3. Create the durable internal session (created, not started).
    let create_input = InternalSessionCreateInput {
        workspace_id: plan.workspace_id.clone(),
        agent_kind: plan.agent_kind.clone(),
        model_id: plan.model_id.clone(),
        mode_id: plan.mode_id.clone(),
        origin: OriginContext::system_local_runtime(),
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
    let session_id = session.id.clone();

    // 4. Persist session_id BEFORE startup.
    if !blocking_bool(&run_id, "bind_session", {
        let service = service.clone();
        let run_id = run_id.clone();
        let session_id = session_id.clone();
        move || service.bind_session(&run_id, &session_id)
    })
    .await?
    {
        return Ok(());
    }

    // 5. Start the persisted session.
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

    // 6. Apply schema-v2 effort after startup and before the step can begin.
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

    // 7. Step pending -> running immediately before dispatch.
    if !blocking_bool(&run_id, "begin_step", {
        let service = service.clone();
        let run_id = run_id.clone();
        move || service.begin_step(&run_id)
    })
    .await?
    {
        return Ok(());
    }

    // 8. Dispatch the one rendered prompt with the deterministic prompt id.
    let acceptance = session_runtime
        .send_text_prompt_with_id(
            &session_id,
            plan.rendered_prompt.clone(),
            plan.prompt_id.clone(),
        )
        .await;
    match acceptance {
        Ok(SendPromptOutcome::Running { turn_id, .. }) => {
            record_turn(service, &run_id, &session_id, turn_id).await;
        }
        Ok(SendPromptOutcome::Queued { .. }) => {
            // Stay running with a null turn id; no queue model, no retry.
        }
        Err(error) => {
            tracing::warn!(
                run_id = %run_id,
                session_id = %session_id,
                "workflow prompt dispatch failed"
            );
            let _: SendPromptError = error;
            return Err(ExecutionAbort::Fail(
                WorkflowRunFailureCode::PromptDispatchFailed,
            ));
        }
    }

    // 9. Drop the lease (on scope exit) — completion arrives via the extension.
    Ok(())
}

/// Record the post-send turn id on the running step. A store failure here does
/// not fail the run: the prompt is already dispatched and the extension owns
/// completion.
async fn record_turn(
    service: &Arc<WorkflowRunService>,
    run_id: &str,
    session_id: &str,
    turn_id: String,
) {
    let service = service.clone();
    let run_id_owned = run_id.to_string();
    let joined =
        tokio::task::spawn_blocking(move || service.record_turn(&run_id_owned, &turn_id)).await;
    match joined {
        Ok(Ok(_)) => {}
        Ok(Err(_error)) => {
            tracing::warn!(
                run_id = %run_id,
                session_id = %session_id,
                "workflow record_turn failed; completion still owned by the extension"
            );
        }
        Err(join_error) => {
            tracing::warn!(
                run_id = %run_id,
                session_id = %session_id,
                error = %join_error,
                "workflow record_turn task join failed"
            );
        }
    }
}

/// Run one guarded synchronous CAS transition on the blocking pool. `Ok(bool)`
/// reports whether the row moved; a store/join infra failure becomes
/// [`ExecutionAbort::Infra`] (logged, nonterminal).
async fn blocking_bool<F>(run_id: &str, step: &'static str, call: F) -> Result<bool, ExecutionAbort>
where
    F: FnOnce() -> Result<bool, WorkflowServiceError> + Send + 'static,
{
    match tokio::task::spawn_blocking(call).await {
        Ok(Ok(moved)) => Ok(moved),
        Ok(Err(_error)) => {
            tracing::error!(run_id = %run_id, step, "workflow transition store failure");
            Err(ExecutionAbort::Infra)
        }
        Err(join_error) => {
            tracing::error!(
                run_id = %run_id,
                step,
                error = %join_error,
                "workflow transition task join failed"
            );
            Err(ExecutionAbort::Infra)
        }
    }
}

/// The one guarded durable failure write for a classified effect failure.
async fn guarded_fail(
    service: &Arc<WorkflowRunService>,
    run_id: &str,
    code: WorkflowRunFailureCode,
) {
    let service = service.clone();
    let run_id_owned = run_id.to_string();
    let joined =
        tokio::task::spawn_blocking(move || service.fail_nonterminal(&run_id_owned, code)).await;
    match joined {
        Ok(Ok(())) => {}
        Ok(Err(_error)) => {
            tracing::error!(
                run_id = %run_id,
                failure_code = code.as_str(),
                "workflow durable failure write failed; rows left nonterminal for fencing"
            );
        }
        Err(join_error) => {
            tracing::error!(
                run_id = %run_id,
                failure_code = code.as_str(),
                error = %join_error,
                "workflow durable failure write task join failed"
            );
        }
    }
}

/// Classify a creation-seam failure (ruling C2A-DEC-01): "missing or
/// unavailable supplied workspace" covers every access-gate refusal (missing,
/// retired, mutation-blocked) plus the service-level workspace-not-found;
/// everything else at this step is a session creation failure.
fn map_create_error(error: &InternalSessionCreateError) -> WorkflowRunFailureCode {
    match error {
        InternalSessionCreateError::WorkspaceUnavailable(_)
        | InternalSessionCreateError::Create(CreateAndStartSessionError::WorkspaceNotFound) => {
            WorkflowRunFailureCode::WorkspaceUnavailable
        }
        InternalSessionCreateError::Create(_) => WorkflowRunFailureCode::SessionCreateFailed,
    }
}

#[cfg(test)]
#[path = "runtime_tests.rs"]
mod tests;
