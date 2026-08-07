//! Wiring family for the materialization knot: the durable service (repo-root
//! acquisition) and the runtime valve (exact-ref workspace materialization,
//! which asks live terminals and live sessions whether a reused workspace is
//! busy) that wraps it. The valve is the only materialization layer holding
//! live power, so its dependency list is the interesting one and it earns its
//! own wiring file. Composition only — no behavior.

use std::sync::Arc;

use crate::domains::materialization::operation_lock::MaterializationOperationLocks;
use crate::domains::materialization::runtime::MaterializationRuntime;
use crate::domains::materialization::service::MaterializationService;
use crate::domains::materialization::store::MaterializationOperationStore;
use crate::domains::repo_roots::service::RepoRootService;
use crate::domains::sessions::runtime::SessionRuntime;
use crate::domains::workspaces::runtime::WorkspaceRuntime;
use crate::live::terminals::TerminalService;
use crate::persistence::Db;

pub(super) struct MaterializationWiringDeps {
    pub db: Db,
    pub workspace_runtime: Arc<WorkspaceRuntime>,
    pub repo_root_service: Arc<RepoRootService>,
    pub session_runtime: Arc<SessionRuntime>,
    pub terminal_service: Arc<TerminalService>,
}

/// Dependency order: the durable service first, then the valve that wraps it.
/// Only the valve escapes to `AppState`; the service is reachable through it.
/// Both share one ledger store and one in-process lock map, so repo-root and
/// workspace operation ids converge/conflict against the same state whichever
/// layer they enter through.
pub(super) fn wire_materialization(
    deps: MaterializationWiringDeps,
) -> Arc<MaterializationRuntime> {
    let store = MaterializationOperationStore::new(deps.db);
    let operation_locks = MaterializationOperationLocks::new();
    let service = Arc::new(MaterializationService::new(
        deps.workspace_runtime.clone(),
        deps.repo_root_service,
        store.clone(),
        operation_locks.clone(),
    ));
    Arc::new(MaterializationRuntime::new(
        service,
        deps.workspace_runtime,
        store,
        operation_locks,
        deps.session_runtime,
        deps.terminal_service,
    ))
}
