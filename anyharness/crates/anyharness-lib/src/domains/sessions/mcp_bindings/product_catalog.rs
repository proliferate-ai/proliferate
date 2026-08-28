use std::sync::Arc;

use crate::domains::sessions::extensions::SessionLaunchExtras;
use crate::domains::sessions::mcp_bindings::model::{
    SessionMcpHeader, SessionMcpHttpServer, SessionMcpServer,
};
use crate::domains::sessions::mcp_bindings::product_launch::{
    ProductMcpLaunchError, ProductMcpLaunchRegistration, ProductMcpSelectionContext,
};
use crate::domains::sessions::model::{SessionMcpBindingPolicy, SessionRecord};
use crate::domains::workspaces::model::{WorkspaceRecord, WorkspaceSurface};
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

pub fn workspace_mcp_should_attach(ctx: ProductMcpSelectionContext<'_>) -> bool {
    ctx.workspace.surface == WorkspaceSurface::Standard
        && ctx.session.mcp_binding_policy != SessionMcpBindingPolicy::InternalOnly
}

pub fn select_product_mcps<'a>(
    workspace: &'a WorkspaceRecord,
    session: &'a SessionRecord,
    registrations: &'a [ProductMcpLaunchRegistration],
) -> Result<Vec<SelectedProductMcp<'a>>, ProductMcpLaunchError> {
    let mut selected = Vec::new();
    for registration in registrations {
        let attached =
            registration.should_attach(ProductMcpSelectionContext { workspace, session })?;
        tracing::info!(
            target: "anyharness.workspace_mcp.selection",
            session_id = %session.id,
            product_mcp_id = registration.definition().id,
            attached,
            workspace_surface = workspace.surface.as_str(),
            mcp_binding_policy = session.mcp_binding_policy.as_str(),
            "product MCP launch selection decided"
        );
        if attached {
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
) -> Result<SessionLaunchExtras, ProductMcpLaunchError> {
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

    #[cfg(test)]
    pub(crate) fn registered_product_ids(&self) -> Vec<&'static str> {
        self.inner
            .as_ref()
            .map(|inner| {
                inner
                    .registrations
                    .iter()
                    .map(|registration| registration.definition().id)
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn resolve_launch_extras(
        &self,
        workspace: &WorkspaceRecord,
        session: &SessionRecord,
    ) -> Result<SessionLaunchExtras, ProductMcpLaunchError> {
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
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    use crate::domains::sessions::mcp_bindings::product_launch::ProductMcpLaunchPhase;
    use crate::domains::sessions::model::{SessionMcpBindingPolicy, SessionRecord};
    use crate::domains::workspaces::model::{
        WorkspaceKind, WorkspaceLifecycleState, WorkspaceRecord, WorkspaceSurface,
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
            archived_head_sha: None,
            archived_branch: None,
            archived_at: None,
            partial_capture_json: None,
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
    fn workspace_selection_is_exactly_standard_and_not_internal_only() {
        let standard = workspace("workspace-standard", "standard");
        let cowork = workspace("workspace-cowork", "cowork");

        let ordinary = session("ordinary", &standard.id);
        assert!(workspace_mcp_should_attach(ProductMcpSelectionContext {
            workspace: &standard,
            session: &ordinary,
        }));

        let mut delegated = session("delegated", &standard.id);
        delegated.subagents_enabled = false;
        assert!(workspace_mcp_should_attach(ProductMcpSelectionContext {
            workspace: &standard,
            session: &delegated,
        }));

        let mut promoted_after_restart = delegated.clone();
        promoted_after_restart.id = "promoted".to_string();
        assert!(workspace_mcp_should_attach(ProductMcpSelectionContext {
            workspace: &standard,
            session: &promoted_after_restart,
        }));

        let mut internal_only = session("review", &standard.id);
        internal_only.mcp_binding_policy = SessionMcpBindingPolicy::InternalOnly;
        assert!(!workspace_mcp_should_attach(ProductMcpSelectionContext {
            workspace: &standard,
            session: &internal_only,
        }));

        let cowork_session = session("cowork", &cowork.id);
        assert!(!workspace_mcp_should_attach(ProductMcpSelectionContext {
            workspace: &cowork,
            session: &cowork_session,
        }));
    }

    #[test]
    fn selector_failure_keeps_product_identity_and_phase_without_partial_selection() {
        let workspace = workspace("workspace-1", "standard");
        let session = session("session-1", &workspace.id);
        let registration = ProductMcpLaunchRegistration::new(
            &TEST_DEFINITION,
            Arc::new(|_ctx| Err(anyhow::anyhow!("private selector detail"))),
            Arc::new(|_, _| Ok("unused".to_string())),
        );
        let registrations = [registration];

        let Err(error) = select_product_mcps(&workspace, &session, &registrations) else {
            panic!("selector failure must fail closed");
        };

        assert_eq!(error.product_mcp_id(), TEST_DEFINITION.id);
        assert_eq!(error.phase(), ProductMcpLaunchPhase::Selection);
        assert!(!error.to_string().contains("private selector detail"));
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
                    harness_args: std::collections::BTreeMap::new(),
                },
            ),
            registration(
                true,
                SessionLaunchExtras {
                    system_prompt_append: vec!["system-b".to_string()],
                    first_prompt_system_prompt_append: vec!["first-b".to_string()],
                    mcp_servers: Vec::new(),
                    mcp_binding_summaries: Vec::new(),
                    harness_args: std::collections::BTreeMap::new(),
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

    #[test]
    fn token_mint_failure_returns_no_launch_extras_and_a_later_retry_remints() {
        let workspace = workspace("workspace-1", "standard");
        let session = session("session-1", &workspace.id);
        let attempts = Arc::new(AtomicUsize::new(0));
        let attempt_counter = attempts.clone();
        let registration = ProductMcpLaunchRegistration::new(
            &INJECTION_TEST_DEFINITION,
            Arc::new(|_ctx| Ok(true)),
            Arc::new(move |_, _| {
                if attempt_counter.fetch_add(1, Ordering::SeqCst) == 0 {
                    Err(anyhow::anyhow!("private token detail"))
                } else {
                    Ok("retry-token".to_string())
                }
            }),
        );
        let catalog = ProductMcpLaunchCatalog::new(
            "http://127.0.0.1:4317".to_string(),
            None,
            vec![registration],
        );

        let Err(error) = catalog.resolve_launch_extras(&workspace, &session) else {
            panic!("first mint must fail closed without launch extras");
        };
        assert_eq!(error.product_mcp_id(), INJECTION_TEST_DEFINITION.id);
        assert_eq!(error.phase(), ProductMcpLaunchPhase::TokenMint);
        assert!(!error.to_string().contains("private token detail"));

        let retry = catalog
            .resolve_launch_extras(&workspace, &session)
            .expect("explicit retry must rerun token mint");
        assert_eq!(attempts.load(Ordering::SeqCst), 2);
        assert_eq!(retry.mcp_servers.len(), 1);
    }
}
