//! Wiring family for checkpoint capture and destructive workspace lifecycle.
//! Checkpoints are built before `SessionRuntime`; archive and purge wrap that
//! runtime afterward. Composition only — no workspace behavior lives here.

use std::path::PathBuf;
use std::sync::Arc;

use crate::domains::repo_roots::service::RepoRootService;
use crate::domains::repo_roots::store::RepoRootStore;
use crate::domains::sessions::admission::SessionMutationAdmission;
use crate::domains::sessions::deletion::SessionDeleteWorkflow;
use crate::domains::sessions::runtime::SessionRuntime;
use crate::domains::sessions::service::SessionService;
use crate::domains::sessions::store::SessionStore;
use crate::domains::workspaces::archive::quiesce::QuiescePlanes;
use crate::domains::workspaces::archive::WorkspaceArchiveService;
use crate::domains::workspaces::checkpoints::WorkspaceCheckpointService;
use crate::domains::workspaces::deletion::purge::WorkspacePurgeService;
use crate::domains::workspaces::operation_gate::WorkspaceOperationGate;
use crate::domains::workspaces::setup_runtime::WorkspaceSetupRuntime;
use crate::domains::workspaces::store::WorkspaceStore;
use crate::live::terminals::TerminalService;
use crate::persistence::Db;

pub(super) fn wire_checkpoints(
    db: &Db,
    operation_gate: Arc<WorkspaceOperationGate>,
) -> Arc<WorkspaceCheckpointService> {
    Arc::new(WorkspaceCheckpointService::new(
        WorkspaceStore::new(db.clone()),
        RepoRootStore::new(db.clone()),
        operation_gate,
    ))
}

pub(super) struct WorkspaceLifecycleWiringDeps {
    pub db: Db,
    pub runtime_home: PathBuf,
    pub checkpoint_service: Arc<WorkspaceCheckpointService>,
    pub operation_gate: Arc<WorkspaceOperationGate>,
    pub setup_runtime: Arc<WorkspaceSetupRuntime>,
    pub session_runtime: Arc<SessionRuntime>,
    pub session_service: Arc<SessionService>,
    pub session_delete_workflow: SessionDeleteWorkflow,
    pub session_admission: Arc<SessionMutationAdmission>,
    pub terminal_service: Arc<TerminalService>,
    pub repo_root_service: Arc<RepoRootService>,
}

pub(super) struct WorkspaceLifecycleWiring {
    pub archive: Arc<WorkspaceArchiveService>,
    pub purge: Arc<WorkspacePurgeService>,
}

pub(super) fn wire_workspace_lifecycle(
    deps: WorkspaceLifecycleWiringDeps,
) -> WorkspaceLifecycleWiring {
    let archive = Arc::new(WorkspaceArchiveService::new(
        WorkspaceStore::new(deps.db.clone()),
        RepoRootStore::new(deps.db.clone()),
        deps.operation_gate.clone(),
        QuiescePlanes {
            setup: deps.setup_runtime.clone(),
            sessions: deps.session_runtime.clone(),
            terminals: deps.terminal_service.clone(),
        },
        deps.session_service,
        deps.runtime_home.clone(),
        deps.checkpoint_service.clone(),
    ));
    let purge = Arc::new(WorkspacePurgeService::new(
        WorkspaceStore::new(deps.db.clone()),
        SessionStore::new(deps.db),
        deps.session_delete_workflow,
        deps.setup_runtime,
        deps.session_runtime,
        deps.terminal_service,
        (*deps.repo_root_service).clone(),
        deps.operation_gate,
        archive.clone(),
        deps.checkpoint_service,
        deps.session_admission,
        deps.runtime_home,
    ));

    // A background pass removes real worktrees, so tests must not spawn it in
    // the middle of suites that build and count real filesystem state.
    #[cfg(not(test))]
    archive.clone().spawn_startup_pass();

    WorkspaceLifecycleWiring { archive, purge }
}
