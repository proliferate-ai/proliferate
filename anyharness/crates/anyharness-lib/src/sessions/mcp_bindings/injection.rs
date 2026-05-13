use crate::domains::reviews::mcp as reviews_mcp;
use crate::integrations::mcp::product_server::{
    ProductMcpDefinition, PRODUCT_MCP_TOKEN_HEADER_NAME,
};
use crate::sessions::extensions::SessionLaunchExtras;
use crate::sessions::mcp_bindings::model::{
    SessionMcpHeader, SessionMcpHttpServer, SessionMcpServer,
};
use crate::sessions::mcp_bindings::selection::{product_mcp_prompt_extras, SelectedProductMcp};
use crate::sessions::model::SessionRecord;
use crate::sessions::subagents::mcp as subagents_mcp;
use crate::sessions::workspace_naming::mcp as workspace_naming_mcp;
use crate::workspaces::model::WorkspaceRecord;

pub struct ProductMcpInjectionContext<'a> {
    pub runtime_base_url: &'a str,
    pub runtime_bearer_token: Option<&'a str>,
    pub review_auth: &'a reviews_mcp::auth::ReviewMcpAuth,
    pub subagent_auth: &'a subagents_mcp::auth::SubagentMcpAuth,
    pub workspace_naming_auth: &'a workspace_naming_mcp::auth::WorkspaceNamingMcpAuth,
    pub workspace: &'a WorkspaceRecord,
    pub session: &'a SessionRecord,
}

pub fn inject_product_mcps(
    selected: &[SelectedProductMcp],
    ctx: ProductMcpInjectionContext<'_>,
) -> anyhow::Result<SessionLaunchExtras> {
    let mut extras = product_mcp_prompt_extras(selected);
    for product in selected {
        extras.mcp_servers.push(match product {
            SelectedProductMcp::Reviews => build_http_server(
                &reviews_mcp::definition::DEFINITION,
                &ctx,
                ctx.review_auth
                    .mint_capability_token(&ctx.workspace.id, &ctx.session.id)?,
            ),
            SelectedProductMcp::Subagents => build_http_server(
                &subagents_mcp::definition::DEFINITION,
                &ctx,
                ctx.subagent_auth
                    .mint_capability_token(&ctx.workspace.id, &ctx.session.id)?,
            ),
            SelectedProductMcp::WorkspaceNaming => build_http_server(
                &workspace_naming_mcp::definition::DEFINITION,
                &ctx,
                ctx.workspace_naming_auth
                    .mint_capability_token(&ctx.workspace.id, &ctx.session.id)?,
            ),
        });
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
    use std::path::PathBuf;

    use crate::origin::OriginContext;
    use crate::sessions::model::{SessionMcpBindingPolicy, SessionRecord};
    use crate::sessions::workspace_naming::mcp::auth::LEGACY_CAPABILITY_HEADER_NAME;
    use crate::workspaces::model::WorkspaceRecord;

    use super::*;

    fn runtime_home(test_name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "anyharness-product-mcp-injection-{test_name}-{}",
            uuid::Uuid::new_v4()
        ));
        let _ = std::fs::remove_dir_all(&path);
        path
    }

    fn workspace(id: &str) -> WorkspaceRecord {
        WorkspaceRecord {
            id: id.to_string(),
            kind: "local".to_string(),
            repo_root_id: None,
            path: format!("/tmp/{id}"),
            surface: "standard".to_string(),
            source_repo_root_path: format!("/tmp/{id}"),
            source_workspace_id: None,
            git_provider: None,
            git_owner: None,
            git_repo_name: None,
            original_branch: Some("main".to_string()),
            current_branch: Some("main".to_string()),
            display_name: None,
            origin: Some(OriginContext::human_desktop()),
            creator_context: None,
            lifecycle_state: "active".to_string(),
            cleanup_state: "none".to_string(),
            cleanup_operation: None,
            cleanup_error_message: None,
            cleanup_failed_at: None,
            cleanup_attempted_at: None,
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
        }
    }

    fn session(id: &str, workspace_id: &str) -> SessionRecord {
        SessionRecord {
            id: id.to_string(),
            workspace_id: workspace_id.to_string(),
            agent_kind: "codex".to_string(),
            native_session_id: None,
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
        let home = runtime_home("fresh");
        let review_auth = reviews_mcp::auth::ReviewMcpAuth::new(home.clone());
        let subagent_auth = subagents_mcp::auth::SubagentMcpAuth::new(home.clone());
        let workspace_naming_auth =
            workspace_naming_mcp::auth::WorkspaceNamingMcpAuth::new(home.clone());
        let workspace = workspace("workspace-1");
        let session = session("session-1", &workspace.id);

        let extras = inject_product_mcps(
            &[SelectedProductMcp::WorkspaceNaming],
            ProductMcpInjectionContext {
                runtime_base_url: "http://127.0.0.1:4317",
                runtime_bearer_token: Some("runtime-token"),
                review_auth: &review_auth,
                subagent_auth: &subagent_auth,
                workspace_naming_auth: &workspace_naming_auth,
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

        let _ = std::fs::remove_dir_all(home);
    }
}
