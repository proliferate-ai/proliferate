use std::sync::Arc;

use crate::domains::repo_roots::service::RepoRootService;
use crate::domains::sessions::admission::SessionMutationAdmission;
use crate::domains::sessions::agent_ops::{
    self as agent_ops_mcp, auth::AgentOpsMcpAuth, tools as agent_ops_mcp_tools, AgentOpsPeerGates,
    AgentOpsProductMcpServer, AgentOpsWorkspaceOps,
};
use crate::domains::sessions::mcp_bindings::product_catalog::ProductMcpLaunchCatalog;
use crate::domains::sessions::mcp_bindings::product_launch::ProductMcpLaunchRegistration;
use crate::domains::sessions::mcp_bindings::product_registry::{
    ProductMcpEndpointHandlerAdapter, ProductMcpEndpointRegistration, ProductMcpEndpointRegistry,
};
use crate::domains::sessions::ownership::service::AgentOwnershipService;
use crate::domains::sessions::runtime::SessionRuntime;
use crate::domains::sessions::subagents::service::SubagentService;
use crate::domains::sessions::wakes::service::AgentWakeService;
use crate::domains::workspaces::operation_gate::{WorkspaceOperationGate, WorkspaceOperationKind};
use crate::domains::workspaces::runtime::WorkspaceRuntime;
use crate::domains::workspaces::worktree_runtime::WorkspaceWorktreeRuntime;

pub(super) struct LaunchCatalogDeps {
    pub(super) runtime_base_url: String,
    pub(super) bearer_token: Option<String>,
    pub(super) agent_ops_mcp_auth: Arc<AgentOpsMcpAuth>,
}

pub(super) struct EndpointRegistryDeps {
    pub(super) subagent_service: Arc<SubagentService>,
    pub(super) agent_wake_service: Arc<AgentWakeService>,
    pub(super) session_runtime: Arc<SessionRuntime>,
    pub(super) workspace_runtime: Arc<WorkspaceRuntime>,
    // The agent ops server creates workspaces through the very services the
    // human routes use; see `AgentOpsWorkspaceOps`.
    pub(super) workspace_worktree_runtime: Arc<WorkspaceWorktreeRuntime>,
    pub(super) repo_root_service: Arc<RepoRootService>,
    pub(super) agent_ownership_service: Arc<AgentOwnershipService>,
    pub(super) session_admission: Arc<SessionMutationAdmission>,
    pub(super) workspace_operation_gate: Arc<WorkspaceOperationGate>,
    pub(super) agent_ops_mcp_auth: Arc<AgentOpsMcpAuth>,
}

pub(super) fn build_product_mcp_launch_catalog(deps: LaunchCatalogDeps) -> ProductMcpLaunchCatalog {
    let LaunchCatalogDeps {
        runtime_base_url,
        bearer_token,
        agent_ops_mcp_auth,
    } = deps;

    let agent_ops_auth = agent_ops_mcp_auth.clone();

    ProductMcpLaunchCatalog::new(
        runtime_base_url,
        bearer_token,
        vec![ProductMcpLaunchRegistration::new(
            &agent_ops_mcp::definition::DEFINITION,
            Arc::new(agent_ops_mcp::definition::should_attach),
            Arc::new(move |workspace_id: &str, session_id: &str| {
                agent_ops_auth.mint_capability_token(workspace_id, session_id)
            }),
        )
        .with_binding_summary(agent_ops_mcp::definition::binding_summary())],
    )
}

pub(super) fn build_product_mcp_endpoint_registry(
    deps: EndpointRegistryDeps,
) -> anyhow::Result<Arc<ProductMcpEndpointRegistry>> {
    let EndpointRegistryDeps {
        subagent_service,
        agent_wake_service,
        session_runtime,
        workspace_runtime,
        workspace_worktree_runtime,
        repo_root_service,
        agent_ownership_service,
        session_admission,
        workspace_operation_gate,
        agent_ops_mcp_auth,
    } = deps;

    let product_mcp_endpoint_registrations = vec![ProductMcpEndpointRegistration::new(Arc::new(
        ProductMcpEndpointHandlerAdapter::new(
            Arc::new(AgentOpsProductMcpServer::new(
                subagent_service.clone(),
                agent_wake_service,
                session_runtime,
                AgentOpsWorkspaceOps {
                    workspace_runtime: workspace_runtime.clone(),
                    worktree_runtime: workspace_worktree_runtime,
                    repo_roots: repo_root_service,
                },
                agent_ownership_service,
                AgentOpsPeerGates {
                    session_admission,
                    workspace_operation_gate,
                },
                agent_ops_mcp_auth,
            )),
            Some(WorkspaceOperationKind::SubagentWrite),
            agent_ops_mcp_tools::MUTATING_TOOL_NAMES,
        ),
    ))];
    ProductMcpEndpointRegistry::new(product_mcp_endpoint_registrations).map(Arc::new)
}
