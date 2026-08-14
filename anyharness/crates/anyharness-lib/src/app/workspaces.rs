//! Wiring family for the destructive workspace use cases: the shared retire
//! preflight checker, the use case that holds it — purge — and the archive
//! orchestrator.
//!
//! They are one family because they are one safety story. `RetirePreflightChecker`
//! is the authoritative "may this workspace be dematerialized" check, purge is
//! the fail-closed pipeline over it, and archive is the reversible sibling that
//! quiesces the same three live planes before touching disk. Grouping them here
//! keeps their construction adjacent instead of spread across the middle of
//! `AppState::new`. Composition only — no behavior.

use std::path::PathBuf;
use std::sync::Arc;

use crate::domains::repo_roots::store::RepoRootStore;
use crate::domains::sessions::admission::SessionMutationAdmission;
use crate::domains::sessions::attachment_storage::PromptAttachmentStorage;
use crate::domains::sessions::runtime::SessionRuntime;
use crate::domains::sessions::service::SessionService;
use crate::domains::sessions::store::SessionStore;
use crate::domains::workspaces::access_gate::WorkspaceAccessGate;
use crate::domains::workspaces::archive::quiesce::QuiescePlanes;
use crate::domains::workspaces::archive::WorkspaceArchiveService;
use crate::domains::workspaces::checkout_gate::CheckoutDeletionGate;
use crate::domains::workspaces::deletion::WorkspaceDeleteWorkflow;
use crate::domains::workspaces::operation_gate::WorkspaceOperationGate;
use crate::domains::workspaces::purge::WorkspacePurgeService;
use crate::domains::workspaces::retire_preflight::RetirePreflightChecker;
use crate::domains::workspaces::runtime::WorkspaceRuntime;
use crate::domains::workspaces::setup_runtime::WorkspaceSetupRuntime;
use crate::domains::workspaces::store::WorkspaceStore;
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
    pub workspace_setup_runtime: Arc<WorkspaceSetupRuntime>,
}

/// The three handles `AppState` keeps from this family.
pub(super) struct WorkspaceDestructionWiring {
    pub preflight_checker: Arc<RetirePreflightChecker>,
    pub purge: Arc<WorkspacePurgeService>,
    pub archive: Arc<WorkspaceArchiveService>,
}

/// Dependency order: the checker first, then the use case that holds it.
pub(super) fn wire_workspace_destruction(
    deps: WorkspaceDestructionDeps,
) -> WorkspaceDestructionWiring {
    let preflight_checker = Arc::new(RetirePreflightChecker::new(
        deps.workspace_runtime.clone(),
        deps.workspace_access_gate.clone(),
        deps.workspace_operation_gate.clone(),
        deps.session_runtime.clone(),
        deps.session_service.clone(),
        deps.terminal_service.clone(),
        deps.runtime_home.clone(),
    ));
    let archive = Arc::new(WorkspaceArchiveService::new(
        WorkspaceStore::new(deps.db.clone()),
        RepoRootStore::new(deps.db.clone()),
        deps.workspace_operation_gate.clone(),
        QuiescePlanes {
            setup: deps.workspace_setup_runtime,
            sessions: deps.session_runtime.clone(),
            terminals: deps.terminal_service.clone(),
        },
        deps.session_service.clone(),
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
    WorkspaceDestructionWiring {
        preflight_checker,
        purge,
        archive,
    }
}
