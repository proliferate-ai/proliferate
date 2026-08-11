//! Composition for the Agent Operations runtime facade.

use std::sync::Arc;

use crate::domains::agent_operations::model::RuntimeIdentity;
use crate::domains::agent_operations::runtime::AgentOperations;
use crate::domains::sessions::admission::SessionMutationAdmission;
use crate::domains::sessions::links::service::SessionLinkService;
use crate::domains::sessions::runtime::SessionRuntime;
use crate::domains::sessions::service::SessionService;
use crate::domains::workspaces::operation_gate::WorkspaceOperationGate;
use crate::domains::workspaces::options::WorkspaceOptionRuntime;

pub(super) struct AgentOperationsWiringDeps {
    pub runtime_identity: RuntimeIdentity,
    pub session_service: Arc<SessionService>,
    pub session_link_service: Arc<SessionLinkService>,
    pub session_runtime: Arc<SessionRuntime>,
    pub workspace_option_runtime: Arc<WorkspaceOptionRuntime>,
    pub session_admission: Arc<SessionMutationAdmission>,
    pub workspace_operation_gate: Arc<WorkspaceOperationGate>,
}

pub(super) fn wire_agent_operations(deps: AgentOperationsWiringDeps) -> Arc<AgentOperations> {
    Arc::new(
        AgentOperations::new(
            deps.runtime_identity,
            deps.session_service.clone(),
            deps.session_link_service,
            deps.session_runtime.clone(),
        )
        .with_workspace_catalogs(
            deps.workspace_option_runtime,
            deps.session_runtime.clone(),
            deps.session_service.clone(),
        )
        .with_ordinary_operations(
            deps.session_runtime,
            deps.session_service,
            deps.session_admission,
            deps.workspace_operation_gate,
        ),
    )
}
