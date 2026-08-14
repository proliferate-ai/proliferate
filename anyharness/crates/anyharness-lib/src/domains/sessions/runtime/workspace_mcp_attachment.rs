use crate::domains::sessions::mcp_bindings::summaries::serialize_binding_summaries;
use crate::domains::sessions::mcp_bindings::workspace_attachment::is_retired_subagents_mcp_binding_summary_id;
use crate::domains::sessions::model::SessionRecord;

use super::SessionRuntime;

impl SessionRuntime {
    pub(super) fn clear_workspace_mcp_binding_summary(
        &self,
        record: &SessionRecord,
    ) -> anyhow::Result<()> {
        let Some(mut summaries) = record.to_contract().mcp_binding_summaries else {
            return Ok(());
        };
        let original_len = summaries.len();
        summaries.retain(|summary| !is_failed_workspace_attachment_summary_id(&summary.id));
        if summaries.len() == original_len {
            return Ok(());
        }
        let summaries_json = if summaries.is_empty() {
            None
        } else {
            serialize_binding_summaries(Some(summaries)).map_err(anyhow::Error::new)?
        };
        self.session_service
            .store()
            .update_mcp_binding_summaries(&record.id, summaries_json)
    }
}

fn is_failed_workspace_attachment_summary_id(id: &str) -> bool {
    is_workspace_mcp_binding_summary_id(id) || is_retired_subagents_mcp_binding_summary_id(id)
}

fn is_workspace_mcp_binding_summary_id(id: &str) -> bool {
    let workspace_id = crate::domains::agent_operations::mcp::definition::ID;
    id == workspace_id || id.strip_prefix("internal:") == Some(workspace_id)
}

#[cfg(test)]
mod tests {
    use super::{
        is_failed_workspace_attachment_summary_id, is_retired_subagents_mcp_binding_summary_id,
        is_workspace_mcp_binding_summary_id,
    };

    #[test]
    fn cleanup_matches_current_and_legacy_workspace_summary_ids_only() {
        assert!(is_workspace_mcp_binding_summary_id("internal:workspace"));
        assert!(is_workspace_mcp_binding_summary_id("workspace"));
        assert!(!is_workspace_mcp_binding_summary_id("internal:reviews"));
        assert!(!is_workspace_mcp_binding_summary_id("workspace-copy"));
    }

    #[test]
    fn failed_workspace_attachment_cleanup_matches_retired_subagents_summaries() {
        assert!(is_retired_subagents_mcp_binding_summary_id(
            "internal:subagents"
        ));
        assert!(is_retired_subagents_mcp_binding_summary_id("subagents"));
        assert!(!is_retired_subagents_mcp_binding_summary_id(
            "internal:reviews"
        ));
        assert!(!is_retired_subagents_mcp_binding_summary_id(
            "subagents-copy"
        ));
    }

    #[test]
    fn failed_workspace_attachment_removes_workspace_and_retired_subagents_summaries() {
        assert_eq!(
            [
                "user-server",
                "internal:subagents",
                "internal:workspace",
                "internal:reviews",
            ]
            .into_iter()
            .filter(|id| !is_failed_workspace_attachment_summary_id(id))
            .collect::<Vec<_>>(),
            ["user-server", "internal:reviews"]
        );
    }
}
