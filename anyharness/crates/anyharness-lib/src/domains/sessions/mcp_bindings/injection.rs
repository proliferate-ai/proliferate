use crate::domains::sessions::extensions::SessionLaunchExtras;
use crate::domains::sessions::mcp_bindings::model::{
    SessionMcpHeader, SessionMcpHttpServer, SessionMcpServer,
};
use crate::domains::sessions::mcp_bindings::selection::{
    product_mcp_prompt_extras, SelectedProductMcp,
};
use crate::domains::sessions::model::SessionRecord;
use crate::domains::workspaces::model::WorkspaceRecord;
use crate::integrations::mcp::product_server::{
    ProductMcpDefinition, PRODUCT_MCP_TOKEN_HEADER_NAME,
};

pub struct ProductMcpInjectionContext<'a> {
    pub runtime_base_url: &'a str,
    pub runtime_bearer_token: Option<&'a str>,
    pub workspace: &'a WorkspaceRecord,
    pub session: &'a SessionRecord,
}

pub fn inject_product_mcps(
    selected: &[SelectedProductMcp<'_>],
    ctx: ProductMcpInjectionContext<'_>,
) -> anyhow::Result<SessionLaunchExtras> {
    let mut extras = product_mcp_prompt_extras(selected);
    for product in selected {
        let registration = product.registration;
        extras.mcp_servers.push(build_http_server(
            registration.definition(),
            &ctx,
            registration.mint_capability_token(&ctx.workspace.id, &ctx.session.id)?,
        ));
    }
    Ok(extras)
}

fn build_http_server(
    definition: &ProductMcpDefinition,
    ctx: &ProductMcpInjectionContext<'_>,
    capability_token: String,
) -> SessionMcpServer {
    let mut headers = Vec::new();
    if let Some(token) = ctx.runtime_bearer_token {
        headers.push(SessionMcpHeader {
            name: "authorization".to_string(),
            value: format!("Bearer {token}"),
        });
    }
    headers.push(SessionMcpHeader {
        name: PRODUCT_MCP_TOKEN_HEADER_NAME.to_string(),
        value: capability_token,
    });

    SessionMcpServer::Http(SessionMcpHttpServer {
        connection_id: definition.id.to_string(),
        catalog_entry_id: None,
        server_name: definition.acp_server_name.to_string(),
        url: format!(
            "{}/v1/workspaces/{}/sessions/{}/mcp/{}",
            ctx.runtime_base_url, ctx.workspace.id, ctx.session.id, definition.route_slug
        ),
        headers,
    })
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use crate::domains::sessions::mcp_bindings::product_launch::{
        ProductMcpLaunchRegistration, ProductMcpSelectionContext,
    };
    use crate::domains::sessions::model::{SessionMcpBindingPolicy, SessionRecord};
    use crate::domains::sessions::workspace_naming::mcp::auth::LEGACY_CAPABILITY_HEADER_NAME;
    use crate::domains::workspaces::model::{
        WorkspaceCleanupState, WorkspaceKind, WorkspaceLifecycleState, WorkspaceRecord,
        WorkspaceSurface,
    };
    use crate::integrations::mcp::product_server::{ProductMcpPromptPolicy, ProductMcpVisibility};
    use crate::origin::OriginContext;

    use super::*;

    fn workspace(id: &str) -> WorkspaceRecord {
        WorkspaceRecord {
            id: id.to_string(),
            kind: WorkspaceKind::Local,
            repo_root_id: format!("repo-root-{id}"),
            path: format!("/tmp/{id}"),
            surface: WorkspaceSurface::Standard,
            original_branch: Some("main".to_string()),
            current_branch: Some("main".to_string()),
            display_name: None,
            origin: Some(OriginContext::human_desktop()),
            creator_context: None,
            lifecycle_state: WorkspaceLifecycleState::Active,
            cleanup_state: WorkspaceCleanupState::None,
            cleanup_operation: None,
            cleanup_error_message: None,
            cleanup_failed_at: None,
            cleanup_attempted_at: None,
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
        }
    }

    static TEST_DEFINITION: ProductMcpDefinition = ProductMcpDefinition {
        id: "workspace_naming",
        route_slug: "workspace_naming",
        acp_server_name: "workspace_naming",
        server_info_name: "proliferate-workspace-naming",
        display_name: "Workspace naming",
        description: "Name workspaces",
        visibility: ProductMcpVisibility::Internal,
        instructions: "Name the workspace",
        unauthorized_code: "WORKSPACE_NAMING_UNAUTHORIZED",
        request_invalid_code: "WORKSPACE_NAMING_INVALID",
        prompt_policy: ProductMcpPromptPolicy::SystemAndFirstPrompt,
    };

    fn selected_registration(token: &'static str) -> ProductMcpLaunchRegistration {
        ProductMcpLaunchRegistration::new(
            &TEST_DEFINITION,
            Arc::new(|_ctx: ProductMcpSelectionContext<'_>| Ok(true)),
            Arc::new(move |_workspace_id: &str, _session_id: &str| Ok(token.to_string())),
        )
    }

    fn session(id: &str, workspace_id: &str) -> SessionRecord {
        SessionRecord {
            id: id.to_string(),
            workspace_id: workspace_id.to_string(),
            agent_kind: "codex".to_string(),
            native_session_id: None,
            agent_auth_scope: None,
            required_agent_auth_revision: None,
            requested_model_id: None,
            current_model_id: None,
            requested_mode_id: None,
            current_mode_id: None,
            title: None,
            thinking_level_id: None,
            thinking_budget_tokens: None,
            status: "idle".to_string(),
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
            last_prompt_at: None,
            closed_at: None,
            dismissed_at: None,
            mcp_bindings_ciphertext: None,
            mcp_binding_summaries_json: None,
            mcp_binding_policy: SessionMcpBindingPolicy::InheritWorkspace,
            system_prompt_append: None,
            subagents_enabled: true,
            action_capabilities_json: None,
            origin: Some(OriginContext::human_desktop()),
        }
    }

    #[test]
    fn fresh_product_injection_uses_generic_route_and_product_token_header() {
        let workspace = workspace("workspace-1");
        let session = session("session-1", &workspace.id);
        let registration = selected_registration("product-token");
        let selected = [SelectedProductMcp {
            registration: &registration,
        }];

        let extras = inject_product_mcps(
            &selected,
            ProductMcpInjectionContext {
                runtime_base_url: "http://127.0.0.1:4317",
                runtime_bearer_token: Some("runtime-token"),
                workspace: &workspace,
                session: &session,
            },
        )
        .expect("inject product mcp");

        let [SessionMcpServer::Http(server)] = extras.mcp_servers.as_slice() else {
            panic!("expected one HTTP product MCP server");
        };
        assert_eq!(server.server_name, "workspace_naming");
        assert_eq!(
            server.url,
            "http://127.0.0.1:4317/v1/workspaces/workspace-1/sessions/session-1/mcp/workspace_naming"
        );
        assert!(
            server
                .headers
                .iter()
                .any(|header| header.name == "authorization"
                    && header.value == "Bearer runtime-token")
        );
        assert!(server
            .headers
            .iter()
            .any(|header| header.name == PRODUCT_MCP_TOKEN_HEADER_NAME));
        assert!(!server
            .headers
            .iter()
            .any(|header| header.name == LEGACY_CAPABILITY_HEADER_NAME));
    }
}
