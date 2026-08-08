pub mod auth;
pub mod calls;
mod calls_helpers;
mod config_ops;
pub mod context;
pub mod definition;
mod peer_ops;
pub mod tools;

use std::sync::Arc;

use async_trait::async_trait;
use serde_json::Value;

use self::auth::AgentOpsMcpAuth;
use self::context::AgentOpsMcpContext;
use crate::domains::sessions::admission::SessionMutationAdmission;
use crate::domains::sessions::runtime::SessionRuntime;
use crate::domains::sessions::subagents::service::SubagentService;
use crate::domains::sessions::wakes::service::AgentWakeService;
use crate::domains::workspaces::operation_gate::WorkspaceOperationGate;
use crate::domains::workspaces::runtime::WorkspaceRuntime;
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

#[derive(Clone)]
pub struct AgentOpsProductMcpServer {
    service: Arc<SubagentService>,
    wake_service: Arc<AgentWakeService>,
    session_runtime: Arc<SessionRuntime>,
    workspace_runtime: Arc<WorkspaceRuntime>,
    peer_gates: AgentOpsPeerGates,
    auth: Arc<AgentOpsMcpAuth>,
}

impl AgentOpsProductMcpServer {
    pub fn new(
        service: Arc<SubagentService>,
        wake_service: Arc<AgentWakeService>,
        session_runtime: Arc<SessionRuntime>,
        workspace_runtime: Arc<WorkspaceRuntime>,
        peer_gates: AgentOpsPeerGates,
        auth: Arc<AgentOpsMcpAuth>,
    ) -> Self {
        Self {
            service,
            wake_service,
            session_runtime,
            workspace_runtime,
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
        context::resolve_context(&self.service, &self.workspace_runtime, request)
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
            &self.peer_gates,
            ctx,
            name,
            arguments,
        )
        .await
    }
}
