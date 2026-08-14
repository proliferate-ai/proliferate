use std::sync::Arc;

use crate::domains::agent_operations::mcp::{
    auth::WorkspaceMcpAuth, tools as workspace_mcp_tools, WorkspaceProductMcpServer,
};
use crate::domains::agent_operations::runtime::AgentOperations;
use crate::domains::cowork::artifacts::CoworkArtifactRuntime;
use crate::domains::cowork::mcp::{
    self as cowork_mcp, auth::CoworkMcpAuth, tools as cowork_mcp_tools, CoworkProductMcpServer,
};
use crate::domains::cowork::runtime::CoworkRuntime;
use crate::domains::reviews::mcp::{
    self as review_mcp, auth::ReviewMcpAuth, tools as review_mcp_tools, ReviewProductMcpServer,
};
use crate::domains::reviews::runtime::ReviewRuntime;
use crate::domains::sessions::mcp_bindings::product_catalog::{
    workspace_mcp_should_attach, ProductMcpLaunchCatalog,
};
use crate::domains::sessions::mcp_bindings::product_launch::{
    ProductMcpLaunchRegistration, ProductMcpSelectionContext,
};
use crate::domains::sessions::mcp_bindings::product_registry::{
    ProductMcpEndpointHandlerAdapter, ProductMcpEndpointRegistration, ProductMcpEndpointRegistry,
};
use crate::domains::workspaces::model::WorkspaceSurface;
use crate::domains::workspaces::operation_gate::WorkspaceOperationKind;

pub(super) struct LaunchCatalogDeps {
    pub(super) runtime_base_url: String,
    pub(super) bearer_token: Option<String>,
    pub(super) workspace_mcp_auth: Arc<WorkspaceMcpAuth>,
    pub(super) review_mcp_auth: Arc<ReviewMcpAuth>,
    pub(super) cowork_mcp_auth: Arc<CoworkMcpAuth>,
}

pub(super) struct EndpointRegistryDeps {
    pub(super) agent_operations: Arc<AgentOperations>,
    pub(super) workspace_mcp_auth: Arc<WorkspaceMcpAuth>,
    pub(super) review_runtime: Arc<ReviewRuntime>,
    pub(super) review_mcp_auth: Arc<ReviewMcpAuth>,
    pub(super) cowork_artifact_runtime: Arc<CoworkArtifactRuntime>,
    pub(super) cowork_runtime: Arc<CoworkRuntime>,
    pub(super) cowork_mcp_auth: Arc<CoworkMcpAuth>,
}

pub(super) fn build_product_mcp_launch_catalog(deps: LaunchCatalogDeps) -> ProductMcpLaunchCatalog {
    let LaunchCatalogDeps {
        runtime_base_url,
        bearer_token,
        workspace_mcp_auth,
        review_mcp_auth,
        cowork_mcp_auth,
    } = deps;

    let review_auth = review_mcp_auth.clone();
    let cowork_auth = cowork_mcp_auth.clone();

    ProductMcpLaunchCatalog::new(
        runtime_base_url,
        bearer_token,
        vec![
            workspace_launch_registration(workspace_mcp_auth),
            ProductMcpLaunchRegistration::new(
                &review_mcp::definition::DEFINITION,
                Arc::new(|ctx: ProductMcpSelectionContext<'_>| {
                    // Reviews intentionally preload on standard sessions. A parent session can
                    // start unrelated and become a review parent later; without live MCP refresh,
                    // the endpoint resolves the current review role on each request.
                    Ok(ctx.workspace.surface == WorkspaceSurface::Standard)
                }),
                Arc::new(move |workspace_id: &str, session_id: &str| {
                    review_auth.mint_capability_token(workspace_id, session_id)
                }),
            )
            .with_binding_summary(review_mcp::definition::binding_summary()),
            ProductMcpLaunchRegistration::new(
                &cowork_mcp::definition::DEFINITION,
                Arc::new(|ctx: ProductMcpSelectionContext<'_>| {
                    Ok(ctx.workspace.surface == WorkspaceSurface::Cowork
                        && !cowork_mcp::definition::launch_disabled())
                }),
                Arc::new(move |workspace_id: &str, session_id: &str| {
                    cowork_auth.mint_capability_token(workspace_id, session_id)
                }),
            )
            .with_system_prompt_append(cowork_mcp::definition::system_prompt_append())
            .with_binding_summary(cowork_mcp::definition::binding_summary()),
        ],
    )
}

fn workspace_launch_registration(
    workspace_mcp_auth: Arc<WorkspaceMcpAuth>,
) -> ProductMcpLaunchRegistration {
    ProductMcpLaunchRegistration::new(
        &crate::domains::agent_operations::mcp::definition::DEFINITION,
        Arc::new(|ctx: ProductMcpSelectionContext<'_>| Ok(workspace_mcp_should_attach(ctx))),
        Arc::new(move |workspace_id: &str, session_id: &str| {
            workspace_mcp_auth.mint_capability_token(workspace_id, session_id)
        }),
    )
    .with_system_prompt_append(
        crate::domains::agent_operations::mcp::definition::system_prompt_append(),
    )
    .with_first_prompt_system_prompt_append(
        crate::domains::agent_operations::mcp::definition::first_prompt_system_prompt_append(),
    )
    .with_applied_http_binding_summary()
}

pub(super) fn build_product_mcp_endpoint_registry(
    deps: EndpointRegistryDeps,
) -> anyhow::Result<Arc<ProductMcpEndpointRegistry>> {
    let EndpointRegistryDeps {
        agent_operations,
        workspace_mcp_auth,
        review_runtime,
        review_mcp_auth,
        cowork_artifact_runtime,
        cowork_runtime,
        cowork_mcp_auth,
    } = deps;

    let product_mcp_endpoint_registrations = vec![
        ProductMcpEndpointRegistration::new(Arc::new(ProductMcpEndpointHandlerAdapter::new(
            Arc::new(WorkspaceProductMcpServer::new(
                agent_operations,
                workspace_mcp_auth,
            )),
            // Workspace creation gates the source and repository through the
            // workspaces owner; there is no caller-workspace operation lease
            // whose lifetime correctly represents creation of a new target.
            None,
            workspace_mcp_tools::MUTATING_TOOL_NAMES,
        ))),
        ProductMcpEndpointRegistration::new(Arc::new(ProductMcpEndpointHandlerAdapter::new(
            Arc::new(ReviewProductMcpServer::new(review_runtime, review_mcp_auth)),
            Some(WorkspaceOperationKind::ReviewWrite),
            review_mcp_tools::MUTATING_TOOL_NAMES,
        ))),
        ProductMcpEndpointRegistration::new(Arc::new(ProductMcpEndpointHandlerAdapter::new(
            Arc::new(CoworkProductMcpServer::new(
                cowork_artifact_runtime,
                cowork_runtime,
                cowork_mcp_auth,
            )),
            Some(WorkspaceOperationKind::CoworkWrite),
            cowork_mcp_tools::MUTATING_TOOL_NAMES,
        ))),
    ];
    ProductMcpEndpointRegistry::new(product_mcp_endpoint_registrations).map(Arc::new)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workspace_registration_delivers_generic_guidance_on_both_launch_channels() {
        let registration = workspace_launch_registration(Arc::new(WorkspaceMcpAuth::new(
            std::env::temp_dir().join("workspace-launch-guidance-test"),
        )));
        let extras = registration.launch_extras();
        let expected = crate::domains::agent_operations::mcp::definition::LAUNCH_GUIDANCE;

        assert_eq!(extras.system_prompt_append.len(), 1);
        assert_eq!(extras.system_prompt_append[0], expected);
        assert_eq!(extras.first_prompt_system_prompt_append.len(), 1);
        assert_eq!(extras.first_prompt_system_prompt_append[0], expected);
        assert!(expected.contains("get_task_output"));
        assert_eq!(extras.mcp_binding_summaries.len(), 1);
    }
}
