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

    // Reviews intentionally attach broadly to standard sessions. Parent
    // sessions may become review parents after launch; until MCP refresh can
    // add product servers live, broad attachment preserves that flow while the
    // endpoint role context exposes no tools for unrelated sessions.
    if should_attach_reviews_mcp(ctx.workspace) {
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

    Ok(selected)
}

fn should_attach_reviews_mcp(workspace: &WorkspaceRecord) -> bool {
    workspace.surface == "standard"
}

pub fn product_mcp_prompt_extras(selected: &[SelectedProductMcp]) -> SessionLaunchExtras {
    let mut extras = SessionLaunchExtras::default();
    for product in selected {
        match product {
            SelectedProductMcp::Reviews => {
                extras
                    .system_prompt_append
                    .extend(reviews_mcp::definition::system_prompt_append());
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
        assert!(should_attach_reviews_mcp(&workspace(
            "standard-1",
            "standard"
        )));
        assert!(!should_attach_reviews_mcp(&workspace("cowork-1", "cowork")));
    }
}
