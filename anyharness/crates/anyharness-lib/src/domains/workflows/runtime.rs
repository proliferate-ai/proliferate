//! The sole async workflow execution facade. `WorkflowRunRuntime` accepts
//! before any effect, spawns exactly one task for a freshly `Created` run, owns
//! the shared workspace-operation lease and the concrete session sequence, and
//! converts every post-acceptance error into one guarded durable failure
//! attempt. Every synchronous service/store call from async code runs on the
//! blocking pool; no lease, transaction, or connection ever survives an
//! unrelated await.

use std::sync::Arc;

use tokio::runtime::Handle;

use crate::domains::sessions::runtime::{
    CreateAndStartSessionError, InternalSessionCreateInput, SendPromptError, SendPromptOutcome,
    SessionRuntime,
};
use crate::domains::workflows::model::WorkflowRunFailureCode;
use crate::domains::workflows::service::{
    AcceptOutcome, WorkflowAcceptError, WorkflowExecutionPlan, WorkflowRunService,
    WorkflowRunValidationError, WorkflowRunView, WorkflowServiceError,
};
use crate::domains::workspaces::operation_gate::{WorkspaceOperationGate, WorkspaceOperationKind};
use crate::origin::OriginContext;

/// The successful PUT result: whether the invocation was newly created (201) or
/// exactly replayed (200), with the durable view either way.
#[derive(Debug)]
pub enum WorkflowPutSuccess {
    Created(WorkflowRunView),
    Replay(WorkflowRunView),
}

/// The PUT failure arm.
#[derive(Debug)]
pub enum WorkflowPutError {
    Invalid(WorkflowRunValidationError),
    Conflict,
    Store(WorkflowServiceError),
    /// Blocking-pool join failure (task panic/cancel).
    Internal(anyhow::Error),
}

/// The GET failure arm.
#[derive(Debug)]
pub enum WorkflowGetError {
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
    main_handle: Handle,
}

impl WorkflowRunRuntime {
    pub fn new(
        service: Arc<WorkflowRunService>,
        session_runtime: Arc<SessionRuntime>,
        operation_gate: Arc<WorkspaceOperationGate>,
        main_handle: Handle,
    ) -> Self {
        Self {
            service,
            session_runtime,
            operation_gate,
            main_handle,
        }
    }

    /// Accept a PUT. Only a fresh `Created` starts execution; replay returns the
    /// current view without any effect; conflict is a typed error.
    #[tracing::instrument(skip_all, fields(run_id = %run_id))]
    pub async fn put(
        &self,
        run_id: String,
        input: crate::domains::workflows::model::PutWorkflowRunInput,
    ) -> Result<WorkflowPutSuccess, WorkflowPutError> {
        let service = self.service.clone();
        let accept_run_id = run_id.clone();
        let outcome = tokio::task::spawn_blocking(move || service.accept(&accept_run_id, input))
            .await
            .map_err(|error| WorkflowPutError::Internal(error.into()))?;

        match outcome {
            Ok(AcceptOutcome::Created { plan, view }) => {
                self.spawn_execution(plan);
                Ok(WorkflowPutSuccess::Created(view))
            }
            Ok(AcceptOutcome::ExactReplay(view)) => Ok(WorkflowPutSuccess::Replay(view)),
            Ok(AcceptOutcome::Conflict) => Err(WorkflowPutError::Conflict),
            Err(WorkflowAcceptError::Invalid(error)) => Err(WorkflowPutError::Invalid(error)),
            Err(WorkflowAcceptError::Store(error)) => Err(WorkflowPutError::Store(error)),
        }
    }

    /// GET the durable view.
    #[tracing::instrument(skip_all, fields(run_id = %run_id))]
    pub async fn get(&self, run_id: String) -> Result<Option<WorkflowRunView>, WorkflowGetError> {
        let service = self.service.clone();
        tokio::task::spawn_blocking(move || service.get(&run_id))
            .await
            .map_err(|error| WorkflowGetError::Internal(error.into()))?
            .map_err(WorkflowGetError::Store)
    }

    fn spawn_execution(&self, plan: WorkflowExecutionPlan) {
        let service = self.service.clone();
        let session_runtime = self.session_runtime.clone();
        let operation_gate = self.operation_gate.clone();
        self.main_handle.spawn(async move {
            execute(service, session_runtime, operation_gate, plan).await;
        });
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

    // 6. Step pending -> running immediately before dispatch.
    if !blocking_bool(&run_id, "begin_step", {
        let service = service.clone();
        let run_id = run_id.clone();
        move || service.begin_step(&run_id)
    })
    .await?
    {
        return Ok(());
    }

    // 7. Dispatch the one rendered prompt with the deterministic prompt id.
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

    // 8. Drop the lease (on scope exit) — completion arrives via the extension.
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

fn map_create_error(error: &CreateAndStartSessionError) -> WorkflowRunFailureCode {
    match error {
        CreateAndStartSessionError::WorkspaceNotFound => {
            WorkflowRunFailureCode::WorkspaceUnavailable
        }
        _ => WorkflowRunFailureCode::SessionCreateFailed,
    }
}
