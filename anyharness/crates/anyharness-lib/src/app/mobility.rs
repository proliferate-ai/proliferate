//! Wiring family for the mobility knot: the durable service (archive export)
//! and the runtime valve (prepare-destination, preflight, install,
//! destroy-source) that wraps it. The valve is the only mobility layer holding
//! live power, so its dependency list is the interesting one and it earns its
//! own wiring file. Composition only — no behavior.

use std::path::PathBuf;
use std::sync::Arc;

use crate::domains::mobility::runtime::MobilityRuntime;
use crate::domains::mobility::service::MobilityService;
use crate::domains::mobility::store::MobilityStore;
use crate::domains::reviews::store::ReviewStore;
use crate::domains::sessions::runtime::SessionRuntime;
use crate::domains::sessions::service::SessionService;
use crate::domains::sessions::subagents::service::SubagentService;
use crate::domains::workspaces::access_gate::WorkspaceAccessGate;
use crate::domains::workspaces::runtime::WorkspaceRuntime;
use crate::domains::workspaces::service::WorkspaceService;
use crate::live::terminals::TerminalService;
use crate::persistence::Db;

pub(super) struct MobilityWiringDeps {
    pub db: Db,
    pub runtime_home: PathBuf,
    pub workspace_service: Arc<WorkspaceService>,
    pub workspace_runtime: Arc<WorkspaceRuntime>,
    pub session_service: Arc<SessionService>,
    pub session_runtime: Arc<SessionRuntime>,
    pub subagent_service: Arc<SubagentService>,
    pub workspace_access_gate: Arc<WorkspaceAccessGate>,
    pub terminal_service: Arc<TerminalService>,
}

/// Dependency order: the durable service first, then the valve that wraps it.
/// Only the valve escapes to `AppState`; the service is reachable through it.
pub(super) fn wire_mobility(deps: MobilityWiringDeps) -> Arc<MobilityRuntime> {
    let service = Arc::new(MobilityService::new(
        deps.workspace_service,
        deps.session_service.clone(),
        deps.subagent_service.clone(),
        deps.workspace_access_gate.clone(),
        deps.runtime_home,
    ));
    Arc::new(MobilityRuntime::new(
        service,
        MobilityStore::new(deps.db.clone()),
        deps.workspace_runtime,
        deps.session_service,
        deps.session_runtime,
        deps.subagent_service,
        ReviewStore::new(deps.db),
        deps.workspace_access_gate,
        deps.terminal_service,
    ))
}
