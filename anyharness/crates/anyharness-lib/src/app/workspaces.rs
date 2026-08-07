//! Wiring family for the destructive workspace use cases: the shared retire
//! preflight checker and the two use cases that hold it — purge and retire.
//!
//! They are one family because they are one safety story. `RetirePreflightChecker`
//! is the authoritative "may this workspace be dematerialized" check, and both
//! purge and retire are the same fail-closed pipeline over it (spec 2b RETIRE-01
//! ruling B: retirement fails closed exactly like purge). Grouping them here
//! keeps the checker's construction adjacent to its only two owners instead of
//! spread across the middle of `AppState::new`. Composition only — no behavior.

use std::path::PathBuf;
use std::sync::Arc;

use crate::domains::sessions::admission::SessionMutationAdmission;
use crate::domains::sessions::attachment_storage::PromptAttachmentStorage;
use crate::domains::sessions::runtime::SessionRuntime;
use crate::domains::sessions::service::SessionService;
use crate::domains::sessions::store::SessionStore;
use crate::domains::workspaces::access_gate::WorkspaceAccessGate;
use crate::domains::workspaces::checkout_gate::CheckoutDeletionGate;
use crate::domains::workspaces::deletion::WorkspaceDeleteWorkflow;
use crate::domains::workspaces::operation_gate::WorkspaceOperationGate;
use crate::domains::workspaces::purge::WorkspacePurgeService;
use crate::domains::workspaces::retire::WorkspaceRetireService;
use crate::domains::workspaces::retire_preflight::RetirePreflightChecker;
use crate::domains::workspaces::runtime::WorkspaceRuntime;
use crate::live::terminals::TerminalService;
use crate::persistence::Db;

pub(super) struct WorkspaceDestructionDeps {
    pub db: Db,
    pub runtime_home: PathBuf,
    pub workspace_runtime: Arc<WorkspaceRuntime>,
    pub workspace_access_gate: Arc<WorkspaceAccessGate>,
    pub workspace_operation_gate: Arc<WorkspaceOperationGate>,
    pub checkout_deletion_gate: Arc<CheckoutDeletionGate>,
    pub workspace_delete_workflow: WorkspaceDeleteWorkflow,
    pub session_runtime: Arc<SessionRuntime>,
    pub session_service: Arc<SessionService>,
    pub session_admission: Arc<SessionMutationAdmission>,
    pub terminal_service: Arc<TerminalService>,
}

/// The three handles `AppState` keeps from this family.
pub(super) struct WorkspaceDestructionWiring {
    /// Also injected into the retention service, which is wired separately.
    pub preflight_checker: Arc<RetirePreflightChecker>,
    pub purge: Arc<WorkspacePurgeService>,
    pub retire: Arc<WorkspaceRetireService>,
}

/// Dependency order: the checker first, then the two use cases that hold it.
pub(super) fn wire_workspace_destruction(
    deps: WorkspaceDestructionDeps,
) -> WorkspaceDestructionWiring {
    let preflight_checker = Arc::new(RetirePreflightChecker::new(
        deps.workspace_runtime.clone(),
        deps.workspace_access_gate.clone(),
        deps.workspace_operation_gate.clone(),
        deps.session_runtime.clone(),
        deps.session_service.clone(),
        deps.terminal_service,
        deps.runtime_home.clone(),
    ));
    let purge = Arc::new(WorkspacePurgeService::new(
        deps.workspace_runtime.clone(),
        deps.session_runtime,
        deps.workspace_delete_workflow,
        SessionStore::new(deps.db),
        PromptAttachmentStorage::new(deps.runtime_home.clone()),
        deps.workspace_operation_gate.clone(),
        deps.session_admission.clone(),
        deps.checkout_deletion_gate,
        preflight_checker.clone(),
        deps.runtime_home,
    ));
    let retire = Arc::new(WorkspaceRetireService::new(
        deps.workspace_runtime,
        deps.workspace_access_gate,
        deps.workspace_operation_gate,
        preflight_checker.clone(),
        deps.session_service,
        deps.session_admission,
    ));
    WorkspaceDestructionWiring {
        preflight_checker,
        purge,
        retire,
    }
}
