//! Construction-only wiring for the workflow-runs domain (spec
//! `systems/product/workflows/runs.md` §7.3). Intentionally two-phase: the workflow
//! session extension must exist before `SessionRuntime::new` (it rides the
//! session extension list), while the completed `SessionRuntime` is injected
//! into `WorkflowRunRuntime` afterwards. No behavior lives here.

use std::sync::Arc;

use tokio::runtime::Handle;

use crate::domains::sessions::admission::SessionMutationAdmission;
use crate::domains::sessions::runtime::SessionRuntime;
use crate::domains::workflows::control::{WorkflowRunGates, WorkflowSessionControllerPolicy};
use crate::domains::workflows::runtime::WorkflowRunRuntime;
use crate::domains::workflows::service::WorkflowRunService;
use crate::domains::workflows::session_extension::WorkflowRunSessionExtension;
use crate::domains::workflows::store::WorkflowRunStore;
use crate::domains::workspaces::access_gate::WorkspaceAccessGate;
use crate::domains::workspaces::operation_gate::WorkspaceOperationGate;
use crate::persistence::Db;

use super::AppStateInitError;

/// Phase-1 output: everything that must exist before `SessionRuntime::new`.
pub(super) struct WorkflowWiringPhaseOne {
    pub service: Arc<WorkflowRunService>,
    pub session_extension: Arc<WorkflowRunSessionExtension>,
    pub gates: Arc<WorkflowRunGates>,
    /// Session mutation admission (spec 2b): sessions own the mechanics; the
    /// injected policy is the Workflows controller lookup, so this is built
    /// here and shared with every mutation owner via AppState.
    pub admission: Arc<SessionMutationAdmission>,
    pub main_handle: Handle,
}

/// Phase 1: build the store and service, synchronously fence interrupted
/// run/step rows (a failure aborts AppState initialization — HTTP must not
/// serve ambiguous rows), capture the process/main Tokio handle, and build the
/// completion extension for the session extension list.
pub(super) fn wire_workflows_before_sessions(
    db: &Db,
) -> Result<WorkflowWiringPhaseOne, AppStateInitError> {
    let service = Arc::new(WorkflowRunService::new(WorkflowRunStore::new(db.clone())));
    service
        .fence_nonterminal_after_restart()
        .map_err(|error| AppStateInitError::WorkflowFencingFailed(anyhow::Error::new(error)))?;
    let main_handle = Handle::current();
    // One shared per-run gate set (spec workflow-run-control §6.1): injected
    // into BOTH the workflow runtime and the completion extension.
    let gates = Arc::new(WorkflowRunGates::new());
    let admission = Arc::new(SessionMutationAdmission::new(Arc::new(
        WorkflowSessionControllerPolicy::new(WorkflowRunStore::new(db.clone())),
    )));
    let session_extension = Arc::new(WorkflowRunSessionExtension::new(
        service.clone(),
        gates.clone(),
        admission.clone(),
        main_handle.clone(),
    ));
    Ok(WorkflowWiringPhaseOne {
        service,
        session_extension,
        gates,
        admission,
        main_handle,
    })
}

/// Phase 2: inject the completed `SessionRuntime` into the sole async workflow
/// facade stored on `AppState`.
pub(super) fn wire_workflow_runtime(
    phase_one: WorkflowWiringPhaseOne,
    session_runtime: Arc<SessionRuntime>,
    operation_gate: Arc<WorkspaceOperationGate>,
    access_gate: Arc<WorkspaceAccessGate>,
) -> Arc<WorkflowRunRuntime> {
    Arc::new(WorkflowRunRuntime::new(
        phase_one.service,
        session_runtime,
        operation_gate,
        access_gate,
        phase_one.gates,
        phase_one.admission,
        phase_one.main_handle,
    ))
}
