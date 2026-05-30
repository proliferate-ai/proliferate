use std::sync::Arc;

use crate::domains::cowork::artifacts::CoworkArtifactRuntime;
use crate::domains::cowork::mcp::{
    self as cowork_mcp, auth::CoworkMcpAuth, tools as cowork_mcp_tools, CoworkProductMcpServer,
};
use crate::domains::cowork::runtime::CoworkRuntime;
use crate::domains::plugins::mcp::{auth::SkillsMcpAuth, SkillsProductMcpServer};
use crate::domains::reviews::mcp::{
    self as review_mcp, auth::ReviewMcpAuth, tools as review_mcp_tools, ReviewProductMcpServer,
};
use crate::domains::reviews::runtime::ReviewRuntime;
use crate::domains::runtime_config::service::RuntimeConfigService;
use crate::persistence::Db;
use crate::sessions::mcp_bindings::product_catalog::ProductMcpLaunchCatalog;
use crate::sessions::mcp_bindings::product_launch::{
    ProductMcpLaunchRegistration, ProductMcpSelectionContext,
};
use crate::sessions::mcp_bindings::product_registry::{
    ProductMcpEndpointHandlerAdapter, ProductMcpEndpointRegistration, ProductMcpEndpointRegistry,
};
use crate::sessions::runtime::SessionRuntime;
use crate::sessions::store::SessionStore;
use crate::sessions::subagents::mcp::{
    auth::SubagentMcpAuth, tools as subagent_mcp_tools, SubagentProductMcpServer,
};
use crate::sessions::subagents::service::SubagentService;
use crate::sessions::workspace_naming::mcp::{
    auth::WorkspaceNamingMcpAuth, WorkspaceNamingProductMcpServer,
};
use crate::workspaces::access_gate::WorkspaceAccessGate;
use crate::workspaces::operation_gate::WorkspaceOperationKind;
use crate::workspaces::runtime::WorkspaceRuntime;

pub(super) struct LaunchCatalogDeps {
    pub(super) runtime_base_url: String,
    pub(super) bearer_token: Option<String>,
    pub(super) review_mcp_auth: Arc<ReviewMcpAuth>,
    pub(super) subagent_mcp_auth: Arc<SubagentMcpAuth>,
    pub(super) workspace_naming_mcp_auth: Arc<WorkspaceNamingMcpAuth>,
    pub(super) cowork_mcp_auth: Arc<CoworkMcpAuth>,
    pub(super) subagent_service: Arc<SubagentService>,
    pub(super) session_store: SessionStore,
}

pub(super) struct EndpointRegistryDeps {
    pub(super) db: Db,
    pub(super) review_runtime: Arc<ReviewRuntime>,
    pub(super) review_mcp_auth: Arc<ReviewMcpAuth>,
    pub(super) subagent_service: Arc<SubagentService>,
    pub(super) session_runtime: Arc<SessionRuntime>,
    pub(super) workspace_runtime: Arc<WorkspaceRuntime>,
    pub(super) subagent_mcp_auth: Arc<SubagentMcpAuth>,
    pub(super) workspace_access_gate: Arc<WorkspaceAccessGate>,
    pub(super) workspace_naming_mcp_auth: Arc<WorkspaceNamingMcpAuth>,
    pub(super) cowork_artifact_runtime: Arc<CoworkArtifactRuntime>,
    pub(super) cowork_runtime: Arc<CoworkRuntime>,
    pub(super) cowork_mcp_auth: Arc<CoworkMcpAuth>,
    pub(super) runtime_config_service: Arc<RuntimeConfigService>,
    pub(super) skills_mcp_auth: Arc<SkillsMcpAuth>,
}

pub(super) fn build_product_mcp_launch_catalog(deps: LaunchCatalogDeps) -> ProductMcpLaunchCatalog {
    let LaunchCatalogDeps {
        runtime_base_url,
        bearer_token,
        review_mcp_auth,
        subagent_mcp_auth,
        workspace_naming_mcp_auth,
        cowork_mcp_auth,
        subagent_service,
        session_store,
    } = deps;

    let review_auth = review_mcp_auth.clone();
    let subagent_auth = subagent_mcp_auth.clone();
    let workspace_naming_auth = workspace_naming_mcp_auth.clone();
    let cowork_auth = cowork_mcp_auth.clone();
    let subagent_selector_service = subagent_service.clone();
    let workspace_naming_session_store = session_store.clone();
    let workspace_naming_prompts =
        crate::sessions::workspace_naming::mcp::definition::system_prompt_append();

    ProductMcpLaunchCatalog::new(
        runtime_base_url,
        bearer_token,
        vec![
            ProductMcpLaunchRegistration::new(
                &review_mcp::definition::DEFINITION,
                Arc::new(|ctx: ProductMcpSelectionContext<'_>| {
                    // Reviews intentionally preload on standard sessions. A parent session can
                    // start unrelated and become a review parent later; without live MCP refresh,
                    // the endpoint resolves the current review role on each request.
                    Ok(ctx.workspace.surface == "standard")
                }),
                Arc::new(move |workspace_id: &str, session_id: &str| {
                    review_auth.mint_capability_token(workspace_id, session_id)
                }),
            )
            .with_binding_summary(review_mcp::definition::binding_summary()),
            ProductMcpLaunchRegistration::new(
                &crate::sessions::subagents::mcp::definition::DEFINITION,
                Arc::new(move |ctx: ProductMcpSelectionContext<'_>| {
                    if ctx.workspace.surface != "standard" || !ctx.session.subagents_enabled {
                        return Ok(false);
                    }
                    Ok(subagent_selector_service
                        .find_subagent_parent(&ctx.session.id)?
                        .is_none())
                }),
                Arc::new(move |workspace_id: &str, session_id: &str| {
                    subagent_auth.mint_capability_token(workspace_id, session_id)
                }),
            )
            .with_binding_summary(crate::sessions::subagents::mcp::definition::binding_summary()),
            ProductMcpLaunchRegistration::new(
                &crate::sessions::workspace_naming::mcp::definition::DEFINITION,
                Arc::new(move |ctx: ProductMcpSelectionContext<'_>| {
                    crate::sessions::workspace_naming::eligibility::eligible_for_launch(
                        &workspace_naming_session_store,
                        ctx.workspace,
                        ctx.session,
                    )
                }),
                Arc::new(move |workspace_id: &str, session_id: &str| {
                    workspace_naming_auth.mint_capability_token(workspace_id, session_id)
                }),
            )
            .with_system_prompt_append(workspace_naming_prompts.clone())
            .with_first_prompt_system_prompt_append(workspace_naming_prompts)
            .with_binding_summary(
                crate::sessions::workspace_naming::mcp::definition::binding_summary(),
            ),
            ProductMcpLaunchRegistration::new(
                &cowork_mcp::definition::DEFINITION,
                Arc::new(|ctx: ProductMcpSelectionContext<'_>| {
                    Ok(ctx.workspace.surface == "cowork"
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

pub(super) fn build_product_mcp_endpoint_registry(
    deps: EndpointRegistryDeps,
) -> anyhow::Result<Arc<ProductMcpEndpointRegistry>> {
    let EndpointRegistryDeps {
        db,
        review_runtime,
        review_mcp_auth,
        subagent_service,
        session_runtime,
        workspace_runtime,
        subagent_mcp_auth,
        workspace_access_gate,
        workspace_naming_mcp_auth,
        cowork_artifact_runtime,
        cowork_runtime,
        cowork_mcp_auth,
        runtime_config_service,
        skills_mcp_auth,
    } = deps;

    let product_mcp_endpoint_registrations = vec![
        ProductMcpEndpointRegistration::new(Arc::new(ProductMcpEndpointHandlerAdapter::new(
            Arc::new(ReviewProductMcpServer::new(review_runtime, review_mcp_auth)),
            Some(WorkspaceOperationKind::ReviewWrite),
            review_mcp_tools::MUTATING_TOOL_NAMES,
        ))),
        ProductMcpEndpointRegistration::new(Arc::new(ProductMcpEndpointHandlerAdapter::new(
            Arc::new(SubagentProductMcpServer::new(
                subagent_service.clone(),
                session_runtime,
                workspace_runtime.clone(),
                subagent_mcp_auth,
            )),
            Some(WorkspaceOperationKind::SubagentWrite),
            subagent_mcp_tools::MUTATING_TOOL_NAMES,
        ))),
        ProductMcpEndpointRegistration::new(Arc::new(ProductMcpEndpointHandlerAdapter::new(
            Arc::new(WorkspaceNamingProductMcpServer::new(
                workspace_runtime,
                workspace_access_gate,
                SessionStore::new(db),
                workspace_naming_mcp_auth,
            )),
            None,
            &[],
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
        ProductMcpEndpointRegistration::new(Arc::new(ProductMcpEndpointHandlerAdapter::new(
            Arc::new(SkillsProductMcpServer::new(
                runtime_config_service,
                skills_mcp_auth,
            )),
            None,
            &[],
        ))),
    ];
    ProductMcpEndpointRegistry::new(product_mcp_endpoint_registrations).map(Arc::new)
}
