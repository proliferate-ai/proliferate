//! The sole async workflow execution facade. `WorkflowRunRuntime` accepts
//! before any effect, spawns exactly one task for a freshly `Created` run, owns
//! the shared workspace-operation lease and the concrete session sequence, and
//! converts every post-acceptance error into one guarded durable failure
//! attempt. Every synchronous service/store call from async code runs on the
//! blocking pool; no lease, transaction, or connection ever survives an
//! unrelated await.

use std::sync::Arc;

use tokio::runtime::Handle;

use crate::domains::sessions::runtime::SessionRuntime;
use crate::domains::workflows::control::{
    cancel_workflow_run, WorkflowCancelError, WorkflowRunGates,
};
use crate::domains::workflows::execution::execute;
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

pub struct WorkflowRunRuntime {
    service: Arc<WorkflowRunService>,
    session_runtime: Arc<SessionRuntime>,
    operation_gate: Arc<WorkspaceOperationGate>,
    access_gate: Arc<WorkspaceAccessGate>,
    gates: Arc<WorkflowRunGates>,
    main_handle: Handle,
}

impl WorkflowRunRuntime {
    pub fn new(
        service: Arc<WorkflowRunService>,
        session_runtime: Arc<SessionRuntime>,
        operation_gate: Arc<WorkspaceOperationGate>,
        access_gate: Arc<WorkspaceAccessGate>,
        gates: Arc<WorkflowRunGates>,
        main_handle: Handle,
    ) -> Self {
        Self {
            service,
            session_runtime,
            operation_gate,
            access_gate,
            gates,
            main_handle,
        }
    }

    /// Merge-gated seam: the shared per-run gates, so tests can hold the exact
    /// production gate to sequence dispatch-versus-cancel deterministically.
    #[cfg(test)]
    pub(crate) fn gates_for_test(&self) -> Arc<WorkflowRunGates> {
        self.gates.clone()
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
        let gates = self.gates.clone();
        let execution_handle = self.main_handle.clone();

        let handoff = self.main_handle.spawn(async move {
            match input {
                VersionedPutWorkflowRunInput::V1(input) => {
                    let run_gate = gates.slot(&run_id).map_err(WorkflowPutError::Internal)?;
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
                            let gates_for_execute = gates.clone();
                            execution_handle.spawn(async move {
                                execute(
                                    service,
                                    session_runtime,
                                    operation_gate,
                                    gates_for_execute,
                                    plan,
                                )
                                .await;
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
                    let run_gate = gates.slot(&run_id).map_err(WorkflowPutError::Internal)?;
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
                            let gates_for_execute = gates.clone();
                            execution_handle.spawn(async move {
                                execute(
                                    service,
                                    session_runtime,
                                    operation_gate,
                                    gates_for_execute,
                                    execution_plan,
                                )
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

    /// Durable cancellation (spec workflow-run-control §5): delegates to the
    /// control module inside the same detached main-runtime handoff as PUT, so
    /// a dropped HTTP future can never cancel the intent-CAS -> live-request
    /// -> final-snapshot sequence.
    #[tracing::instrument(skip_all, fields(run_id = %run_id))]
    pub async fn cancel(
        &self,
        run_id: String,
    ) -> Result<crate::domains::workflows::service::VersionedWorkflowRunView, WorkflowCancelError>
    {
        let service = self.service.clone();
        let session_runtime = self.session_runtime.clone();
        let gates = self.gates.clone();
        let handoff = self.main_handle.spawn(async move {
            cancel_workflow_run(service, session_runtime, gates, run_id).await
        });
        handoff
            .await
            .map_err(|error| WorkflowCancelError::Internal(error.into()))?
    }
}

#[cfg(test)]
#[path = "runtime_tests.rs"]
mod tests;
