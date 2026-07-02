use std::sync::Arc;

use crate::domains::sessions::extensions::SessionLaunchExtras;
use crate::domains::sessions::mcp_bindings::model::{
    SessionMcpHeader, SessionMcpHttpServer, SessionMcpServer,
};
use crate::domains::sessions::mcp_bindings::product_launch::{
    ProductMcpLaunchRegistration, ProductMcpSelectionContext,
};
use crate::domains::sessions::model::SessionRecord;
use crate::domains::workspaces::model::WorkspaceRecord;
use crate::integrations::mcp::product_server::{
    ProductMcpDefinition, PRODUCT_MCP_TOKEN_HEADER_NAME,
};

// ── Selection ────────────────────────────────────────────────────────────────
// Selection graduates back to its own policy file the day it gains its first
// real rule (plan gating, workspace-kind exclusion, per-org policy). Today it
// is a trivial loop over registration selectors and stays inline.

pub struct SelectedProductMcp<'a> {
    pub registration: &'a ProductMcpLaunchRegistration,
}

pub fn select_product_mcps<'a>(
    workspace: &'a WorkspaceRecord,
    session: &'a SessionRecord,
    registrations: &'a [ProductMcpLaunchRegistration],
) -> anyhow::Result<Vec<SelectedProductMcp<'a>>> {
    let mut selected = Vec::new();
    for registration in registrations {
        if registration.should_attach(ProductMcpSelectionContext { workspace, session })? {
            selected.push(SelectedProductMcp { registration });
        }
    }
    Ok(selected)
}

pub fn product_mcp_prompt_extras(selected: &[SelectedProductMcp<'_>]) -> SessionLaunchExtras {
    let mut extras = SessionLaunchExtras::default();
    for product in selected {
        merge_launch_extras(&mut extras, product.registration.launch_extras());
    }
    extras
}

fn merge_launch_extras(target: &mut SessionLaunchExtras, source: &SessionLaunchExtras) {
    target
        .system_prompt_append
        .extend(source.system_prompt_append.clone());
    target
        .first_prompt_system_prompt_append
        .extend(source.first_prompt_system_prompt_append.clone());
    target
        .mcp_binding_summaries
        .extend(source.mcp_binding_summaries.clone());
}

// ── Injection ────────────────────────────────────────────────────────────────

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

// ── Launch catalog ───────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct ProductMcpLaunchCatalog {
    inner: Option<Arc<ProductMcpLaunchCatalogInner>>,
}

struct ProductMcpLaunchCatalogInner {
    runtime_base_url: String,
    runtime_bearer_token: Option<String>,
    registrations: Vec<ProductMcpLaunchRegistration>,
}

impl ProductMcpLaunchCatalog {
    pub fn new(
        runtime_base_url: String,
        runtime_bearer_token: Option<String>,
        registrations: Vec<ProductMcpLaunchRegistration>,
    ) -> Self {
        Self {
            inner: Some(Arc::new(ProductMcpLaunchCatalogInner {
                runtime_base_url,
                runtime_bearer_token,
                registrations,
            })),
        }
    }

    pub fn disabled() -> Self {
        Self { inner: None }
    }

    pub fn resolve_launch_extras(
        &self,
        workspace: &WorkspaceRecord,
        session: &SessionRecord,
    ) -> anyhow::Result<SessionLaunchExtras> {
        let Some(inner) = self.inner.as_ref() else {
            return Ok(SessionLaunchExtras::default());
        };
        let selected = select_product_mcps(workspace, session, &inner.registrations)?;
        inject_product_mcps(
            &selected,
            ProductMcpInjectionContext {
                runtime_base_url: &inner.runtime_base_url,
                runtime_bearer_token: inner.runtime_bearer_token.as_deref(),
                workspace,
                session,
            },
        )
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use crate::domains::sessions::model::{SessionMcpBindingPolicy, SessionRecord};
    use crate::domains::workspaces::model::{
        WorkspaceCleanupState, WorkspaceKind, WorkspaceLifecycleState, WorkspaceRecord,
        WorkspaceSurface,
    };
    use crate::integrations::mcp::product_server::{
        ProductMcpDefinition, ProductMcpPromptPolicy, ProductMcpVisibility,
        PRODUCT_MCP_TOKEN_HEADER_NAME,
    };
    use crate::origin::OriginContext;

    use super::*;

    static TEST_DEFINITION: ProductMcpDefinition = ProductMcpDefinition {
        id: "test",
        route_slug: "test",
        acp_server_name: "test",
        server_info_name: "proliferate-test",
        display_name: "Test",
        description: "Test",
        visibility: ProductMcpVisibility::Internal,
        instructions: "Test",
        unauthorized_code: "TEST_UNAUTHORIZED",
        request_invalid_code: "TEST_INVALID",
        prompt_policy: ProductMcpPromptPolicy::System,
    };

    static INJECTION_TEST_DEFINITION: ProductMcpDefinition = ProductMcpDefinition {
        id: "injection_probe",
        route_slug: "injection_probe",
        acp_server_name: "injection_probe",
        server_info_name: "proliferate-injection-probe",
        display_name: "Injection probe",
        description: "Injection probe",
        visibility: ProductMcpVisibility::Internal,
        instructions: "Injection probe",
        unauthorized_code: "INJECTION_PROBE_UNAUTHORIZED",
        request_invalid_code: "INJECTION_PROBE_INVALID",
        prompt_policy: ProductMcpPromptPolicy::SystemAndFirstPrompt,
    };

    fn workspace(id: &str, surface: &str) -> WorkspaceRecord {
        WorkspaceRecord {
            id: id.to_string(),
            kind: WorkspaceKind::Local,
            repo_root_id: format!("repo-root-{id}"),
            path: format!("/tmp/{id}"),
            surface: WorkspaceSurface::try_from(surface).expect("test workspace surface"),
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

    fn session(id: &str, workspace_id: &str) -> SessionRecord {
        SessionRecord {
            id: id.to_string(),
            workspace_id: workspace_id.to_string(),
            agent_kind: "codex".to_string(),
            native_session_id: None,
            agent_auth_contexts: None,
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

    fn registration(
        should_attach: bool,
        extras: SessionLaunchExtras,
    ) -> ProductMcpLaunchRegistration {
        ProductMcpLaunchRegistration::new(
            &TEST_DEFINITION,
            Arc::new(move |_ctx: ProductMcpSelectionContext<'_>| Ok(should_attach)),
            Arc::new(|_workspace_id: &str, _session_id: &str| Ok("token".to_string())),
        )
        .with_system_prompt_append(extras.system_prompt_append)
        .with_first_prompt_system_prompt_append(extras.first_prompt_system_prompt_append)
    }

    fn selected_registration(token: &'static str) -> ProductMcpLaunchRegistration {
        ProductMcpLaunchRegistration::new(
            &INJECTION_TEST_DEFINITION,
            Arc::new(|_ctx: ProductMcpSelectionContext<'_>| Ok(true)),
            Arc::new(move |_workspace_id: &str, _session_id: &str| Ok(token.to_string())),
        )
    }

    // ── selection tests ──────────────────────────────────────────────────────

    #[test]
    fn selection_uses_app_wired_product_capabilities() {
        let workspace = workspace("workspace-1", "standard");
        let session = session("session-1", &workspace.id);
        let registrations = [registration(true, SessionLaunchExtras::default())];
        let selected =
            select_product_mcps(&workspace, &session, &registrations).expect("select product MCPs");

        assert_eq!(selected.len(), 1);
    }

    #[test]
    fn selection_skips_unavailable_app_wired_capabilities() {
        let workspace = workspace("workspace-1", "standard");
        let session = session("session-1", &workspace.id);
        let registrations = [registration(false, SessionLaunchExtras::default())];
        let selected =
            select_product_mcps(&workspace, &session, &registrations).expect("select product MCPs");

        assert!(selected.is_empty());
    }

    #[test]
    fn selected_product_extras_merge_in_launch_order() {
        let workspace = workspace("workspace-1", "standard");
        let session = session("session-1", &workspace.id);
        let registrations = [
            registration(
                true,
                SessionLaunchExtras {
                    system_prompt_append: vec!["system-a".to_string()],
                    first_prompt_system_prompt_append: Vec::new(),
                    mcp_servers: Vec::new(),
                    mcp_binding_summaries: Vec::new(),
                },
            ),
            registration(
                true,
                SessionLaunchExtras {
                    system_prompt_append: vec!["system-b".to_string()],
                    first_prompt_system_prompt_append: vec!["first-b".to_string()],
                    mcp_servers: Vec::new(),
                    mcp_binding_summaries: Vec::new(),
                },
            ),
        ];
        let selected =
            select_product_mcps(&workspace, &session, &registrations).expect("select product MCPs");
        let extras = product_mcp_prompt_extras(&selected);

        assert_eq!(extras.system_prompt_append, ["system-a", "system-b"]);
        assert_eq!(extras.first_prompt_system_prompt_append, ["first-b"]);
    }

    // ── injection tests ──────────────────────────────────────────────────────

    #[test]
    fn fresh_product_injection_uses_generic_route_and_product_token_header() {
        let workspace = workspace("workspace-1", "standard");
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
        assert_eq!(server.server_name, "injection_probe");
        assert_eq!(
            server.url,
            "http://127.0.0.1:4317/v1/workspaces/workspace-1/sessions/session-1/mcp/injection_probe"
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
    }
}
