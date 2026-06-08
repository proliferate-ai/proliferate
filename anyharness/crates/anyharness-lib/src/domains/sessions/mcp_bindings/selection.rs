use crate::domains::sessions::extensions::SessionLaunchExtras;
use crate::domains::sessions::mcp_bindings::product_launch::{
    ProductMcpLaunchRegistration, ProductMcpSelectionContext,
};
use crate::domains::sessions::model::SessionRecord;
use crate::domains::workspaces::model::WorkspaceRecord;

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

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use crate::domains::sessions::model::SessionMcpBindingPolicy;
    use crate::domains::workspaces::model::{
        WorkspaceCleanupState, WorkspaceKind, WorkspaceLifecycleState, WorkspaceSurface,
    };
    use crate::integrations::mcp::product_server::{
        ProductMcpDefinition, ProductMcpPromptPolicy, ProductMcpVisibility,
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
}
