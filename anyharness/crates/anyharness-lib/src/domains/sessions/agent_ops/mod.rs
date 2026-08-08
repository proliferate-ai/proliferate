pub mod auth;
pub mod calls;
mod calls_helpers;
mod config_ops;
pub mod context;
pub mod definition;
// The peer gates are the runtime's ownership-independent fence: session
// mutation permit, then the TARGET workspace's write lease, in that order
// (PR1227-LOCK-01). The deferred close in `sessions::ownership::hooks` takes
// exactly the same pair, so it reuses these rather than restating a lock-order
// contract in a second place.
pub(crate) mod peer_ops;
// The one routine that creates an agent, shared by both spawn shapes so they
// cannot drift apart on anything that is not about ownership (ADR §3.3).
mod spawn_ops;
pub mod tools;
// Where an agent may put a NEW workspace, and how one gets made — the
// local-only gate, the creator stamp, and the server-side creation defaults
// (ADR §3.3/§3.4). Retirement is deliberately absent: ruling 11.
mod workspace_ops;

use std::sync::Arc;

use async_trait::async_trait;
use serde_json::Value;

use self::auth::AgentOpsMcpAuth;
use self::context::AgentOpsMcpContext;
use crate::domains::repo_roots::service::RepoRootService;
use crate::domains::sessions::admission::SessionMutationAdmission;
use crate::domains::sessions::ownership::service::AgentOwnershipService;
use crate::domains::sessions::runtime::SessionRuntime;
use crate::domains::sessions::subagents::service::SubagentService;
use crate::domains::sessions::wakes::service::AgentWakeService;
use crate::domains::workspaces::operation_gate::WorkspaceOperationGate;
use crate::domains::workspaces::runtime::WorkspaceRuntime;
use crate::domains::workspaces::worktree_runtime::WorkspaceWorktreeRuntime;
use crate::integrations::mcp::product_server::{
    ProductMcpAuthHeader, ProductMcpContextError, ProductMcpDefinition, ProductMcpRequestContext,
    ProductMcpServer, ProductMcpTokenValidation,
};

/// The two gates a peer send takes for itself, because the route layer cannot:
/// admission is per-SESSION (the route knows only the caller's session), and
/// the workspace lease belongs to the TARGET's workspace (the route knows only
/// the caller's). Threaded through registration like every other dependency
/// here; see `agent_ops::peer_ops` for the ordering contract.
#[derive(Clone)]
pub struct AgentOpsPeerGates {
    pub session_admission: Arc<SessionMutationAdmission>,
    pub workspace_operation_gate: Arc<WorkspaceOperationGate>,
}

/// Everything the workspace tools need to describe and create one, bundled
/// because they are the SAME dependencies the human creation surfaces use — the
/// worktree runtime behind `POST /v1/workspaces/worktrees`, the workspace
/// runtime behind `POST /v1/workspaces`, and the repo-root service behind the
/// picker. Bundled rather than added as three more constructor arguments so the
/// point stays legible: this is the human creation path, borrowed.
#[derive(Clone)]
pub struct AgentOpsWorkspaceOps {
    pub workspace_runtime: Arc<WorkspaceRuntime>,
    pub worktree_runtime: Arc<WorkspaceWorktreeRuntime>,
    pub repo_roots: Arc<RepoRootService>,
}

#[derive(Clone)]
pub struct AgentOpsProductMcpServer {
    service: Arc<SubagentService>,
    wake_service: Arc<AgentWakeService>,
    session_runtime: Arc<SessionRuntime>,
    workspaces: AgentOpsWorkspaceOps,
    ownership: Arc<AgentOwnershipService>,
    peer_gates: AgentOpsPeerGates,
    auth: Arc<AgentOpsMcpAuth>,
}

impl AgentOpsProductMcpServer {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        service: Arc<SubagentService>,
        wake_service: Arc<AgentWakeService>,
        session_runtime: Arc<SessionRuntime>,
        workspaces: AgentOpsWorkspaceOps,
        ownership: Arc<AgentOwnershipService>,
        peer_gates: AgentOpsPeerGates,
        auth: Arc<AgentOpsMcpAuth>,
    ) -> Self {
        Self {
            service,
            wake_service,
            session_runtime,
            workspaces,
            ownership,
            peer_gates,
            auth,
        }
    }
}

#[async_trait]
impl ProductMcpServer for AgentOpsProductMcpServer {
    type Context = AgentOpsMcpContext;

    fn definition(&self) -> &'static ProductMcpDefinition {
        &definition::DEFINITION
    }

    fn validate_capability_token(
        &self,
        header: ProductMcpAuthHeader<'_>,
        request: &ProductMcpRequestContext,
    ) -> anyhow::Result<ProductMcpTokenValidation> {
        self.auth.validate_capability_header(header, request)
    }

    fn resolve_context(
        &self,
        request: &ProductMcpRequestContext,
    ) -> Result<Self::Context, ProductMcpContextError> {
        context::resolve_context(&self.service, &self.workspaces.workspace_runtime, request)
    }

    fn tools(&self, ctx: &Self::Context) -> Vec<Value> {
        tools::build_tool_list(ctx)
    }

    async fn call_tool(
        &self,
        ctx: &Self::Context,
        name: &str,
        arguments: Option<Value>,
    ) -> anyhow::Result<Value> {
        calls::call_tool(
            &self.service,
            &self.wake_service,
            &self.session_runtime,
            &self.ownership,
            &self.peer_gates,
            &self.workspaces,
            ctx,
            name,
            arguments,
        )
        .await
    }
}
