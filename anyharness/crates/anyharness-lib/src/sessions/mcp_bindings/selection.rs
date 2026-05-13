use crate::domains::cowork::mcp as cowork_mcp;
use crate::domains::reviews::mcp as reviews_mcp;
use crate::sessions::extensions::SessionLaunchExtras;
use crate::sessions::model::SessionRecord;
use crate::sessions::store::SessionStore;
use crate::sessions::subagents::service::SubagentService;
use crate::sessions::workspace_naming::{eligibility, mcp as workspace_naming_mcp};
use crate::workspaces::model::WorkspaceRecord;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SelectedProductMcp {
    Reviews,
    Subagents,
    WorkspaceNaming,
    Cowork,
}

pub struct ProductMcpSelectionContext<'a> {
    pub workspace: &'a WorkspaceRecord,
    pub session: &'a SessionRecord,
    pub subagent_service: &'a SubagentService,
    pub session_store: &'a SessionStore,
}

pub fn select_product_mcps(
    ctx: ProductMcpSelectionContext<'_>,
) -> anyhow::Result<Vec<SelectedProductMcp>> {
    let mut selected = Vec::new();

    // Reviews intentionally preload on standard sessions. A parent session can
    // start unrelated and become a review parent later; without live MCP refresh,
    // the review MCP must already be attached for that later parent tool surface.
    // The endpoint resolves the current review role on each request, so unrelated
    // sessions receive no review tools even though the server is attached.
    if should_preload_reviews_mcp_until_live_refresh(ctx.workspace) {
        selected.push(SelectedProductMcp::Reviews);
    }

    if ctx.workspace.surface == "standard"
        && ctx.session.subagents_enabled
        && ctx
            .subagent_service
            .find_subagent_parent(&ctx.session.id)?
            .is_none()
    {
        selected.push(SelectedProductMcp::Subagents);
    }

    if eligibility::eligible_for_launch(ctx.session_store, ctx.workspace, ctx.session)? {
        selected.push(SelectedProductMcp::WorkspaceNaming);
    }

    if should_attach_cowork_mcp(ctx.workspace) {
        selected.push(SelectedProductMcp::Cowork);
    }

    Ok(selected)
}

fn should_preload_reviews_mcp_until_live_refresh(workspace: &WorkspaceRecord) -> bool {
    workspace.surface == "standard"
}

fn should_attach_cowork_mcp(workspace: &WorkspaceRecord) -> bool {
    workspace.surface == "cowork" && !cowork_mcp::definition::launch_disabled()
}

pub fn product_mcp_prompt_extras(selected: &[SelectedProductMcp]) -> SessionLaunchExtras {
    let mut extras = SessionLaunchExtras::default();
    for product in selected {
        match product {
            SelectedProductMcp::Reviews => {
                // The review MCP server is preloaded broadly so parent sessions
                // can become review parents after launch. Do not also preload
                // review-specific prompt text into unrelated sessions; review
                // runtime prompts add role-specific instructions when review
                // work actually starts.
                extras
                    .mcp_binding_summaries
                    .push(reviews_mcp::definition::binding_summary());
            }
            SelectedProductMcp::Subagents => {
                extras
                    .system_prompt_append
                    .extend(crate::sessions::subagents::mcp::definition::system_prompt_append());
                extras
                    .mcp_binding_summaries
                    .push(crate::sessions::subagents::mcp::definition::binding_summary());
            }
            SelectedProductMcp::WorkspaceNaming => {
                let prompts = workspace_naming_mcp::definition::system_prompt_append();
                extras.system_prompt_append.extend(prompts.clone());
                extras.first_prompt_system_prompt_append.extend(prompts);
                extras
                    .mcp_binding_summaries
                    .push(workspace_naming_mcp::definition::binding_summary());
            }
            SelectedProductMcp::Cowork => {
                extras
                    .system_prompt_append
                    .extend(cowork_mcp::definition::system_prompt_append());
                extras
                    .mcp_binding_summaries
                    .push(cowork_mcp::definition::binding_summary());
            }
        }
    }
    extras
}

#[cfg(test)]
mod tests {
    use crate::origin::OriginContext;

    use super::*;

    fn workspace(id: &str, surface: &str) -> WorkspaceRecord {
        WorkspaceRecord {
            id: id.to_string(),
            kind: "local".to_string(),
            repo_root_id: None,
            path: format!("/tmp/{id}"),
            surface: surface.to_string(),
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

    #[test]
    fn reviews_mcp_broadly_attaches_to_standard_workspaces_only() {
        assert!(should_preload_reviews_mcp_until_live_refresh(&workspace(
            "standard-1",
            "standard"
        )));
        assert!(!should_preload_reviews_mcp_until_live_refresh(&workspace(
            "cowork-1", "cowork"
        )));
    }

    #[test]
    fn cowork_mcp_attaches_to_cowork_workspaces_only() {
        assert!(should_attach_cowork_mcp(&workspace("cowork-1", "cowork")));
        assert!(!should_attach_cowork_mcp(&workspace(
            "standard-1",
            "standard"
        )));
    }

    #[test]
    fn broad_reviews_selection_does_not_add_review_prompt_text() {
        let extras = product_mcp_prompt_extras(&[SelectedProductMcp::Reviews]);

        assert!(extras.system_prompt_append.is_empty());
        assert_eq!(extras.mcp_binding_summaries.len(), 1);
    }

    #[test]
    fn workspace_naming_selection_adds_prompt_text_and_binding_summary() {
        let extras = product_mcp_prompt_extras(&[SelectedProductMcp::WorkspaceNaming]);

        assert!(!extras.system_prompt_append.is_empty());
        assert!(!extras.first_prompt_system_prompt_append.is_empty());
        assert_eq!(extras.mcp_binding_summaries.len(), 1);
        assert_eq!(
            extras.mcp_binding_summaries[0].server_name,
            workspace_naming_mcp::definition::ACP_SERVER_NAME
        );
    }

    #[test]
    fn cowork_selection_adds_prompt_text_and_binding_summary() {
        let extras = product_mcp_prompt_extras(&[SelectedProductMcp::Cowork]);

        assert!(!extras.system_prompt_append.is_empty());
        assert_eq!(extras.mcp_binding_summaries.len(), 1);
        assert_eq!(
            extras.mcp_binding_summaries[0].server_name,
            cowork_mcp::definition::ACP_SERVER_NAME
        );
    }
}
