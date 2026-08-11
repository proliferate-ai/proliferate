use std::collections::HashMap;

use crate::domains::agent_operations::model::AuthenticatedAgentCaller;
use crate::domains::agent_operations::subagents::{
    SubagentLatestCompletionView, SubagentParentRoster, SubagentRelationshipView,
    SubagentRosterEntry, WorkspaceSubagentRoster,
};
use crate::domains::sessions::links::model::SessionLinkRecord;
use crate::domains::sessions::model::SessionRecord;
use crate::domains::sessions::subagents::model::SubagentCompletionRecord;
use crate::domains::workspaces::options::WorkspaceOptionsError;

use super::{AgentOperations, AgentOperationsError, ResolvedAgent};

impl AgentOperations {
    #[tracing::instrument(skip_all, fields(operation = "session_subagent_roster"))]
    pub async fn session_subagent_roster(
        &self,
        caller: &AuthenticatedAgentCaller,
    ) -> Result<SubagentParentRoster, AgentOperationsError> {
        let parent = self.resolve_caller_agent(caller)?;
        let links = self
            .relationships
            .list_children_including_closed(&parent.record.id)
            .map_err(AgentOperationsError::Internal)?;
        let completions = self.latest_completions(&links)?;
        self.build_parent_roster(parent, links, &completions).await
    }

    #[tracing::instrument(skip_all, fields(operation = "workspace_subagent_roster"))]
    pub async fn workspace_subagent_roster(
        &self,
        workspace_id: &str,
    ) -> Result<WorkspaceSubagentRoster, AgentOperationsError> {
        if self
            .workspace_operations()?
            .get_workspace(workspace_id)
            .await?
            .is_none()
        {
            return Err(AgentOperationsError::Workspace(
                WorkspaceOptionsError::WorkspaceNotFound(workspace_id.to_string()),
            ));
        }

        let links = self
            .relationships
            .list_for_workspace(workspace_id)
            .map_err(AgentOperationsError::Internal)?;
        let completions = self.latest_completions(&links)?;
        let mut grouped: Vec<(String, Vec<SessionLinkRecord>)> = Vec::new();
        let mut indexes = HashMap::new();
        for link in links {
            let index = match indexes.get(&link.parent_session_id).copied() {
                Some(index) => index,
                None => {
                    let index = grouped.len();
                    indexes.insert(link.parent_session_id.clone(), index);
                    grouped.push((link.parent_session_id.clone(), Vec::new()));
                    index
                }
            };
            grouped[index].1.push(link);
        }

        let mut parents = Vec::with_capacity(grouped.len());
        for (parent_session_id, links) in grouped {
            let Some(parent_record) = self
                .sessions
                .get_session(&parent_session_id)
                .map_err(AgentOperationsError::Internal)?
            else {
                continue;
            };
            let parent = self.resolve_record(parent_record)?;
            parents.push(
                self.build_parent_roster(parent, links, &completions)
                    .await?,
            );
        }

        Ok(WorkspaceSubagentRoster {
            workspace_id: workspace_id.to_string(),
            parents,
        })
    }

    fn latest_completions(
        &self,
        links: &[SessionLinkRecord],
    ) -> Result<HashMap<String, SubagentCompletionRecord>, AgentOperationsError> {
        let Some(reads) = self.subagent_completions.as_ref() else {
            return Ok(HashMap::new());
        };
        let link_ids = links.iter().map(|link| link.id.clone()).collect::<Vec<_>>();
        Ok(reads
            .latest_completions_for_links(&link_ids)
            .map_err(AgentOperationsError::Internal)?
            .into_iter()
            .map(|completion| (completion.session_link_id.clone(), completion))
            .collect())
    }

    async fn build_parent_roster(
        &self,
        parent: ResolvedAgent,
        links: Vec<SessionLinkRecord>,
        completions: &HashMap<String, SubagentCompletionRecord>,
    ) -> Result<SubagentParentRoster, AgentOperationsError> {
        let parent_view = self.project_agent(&parent, Some(&parent)).await?;
        let mut children = Vec::with_capacity(links.len());
        for link in links {
            let Some(child_record) = self
                .sessions
                .get_session(&link.child_session_id)
                .map_err(AgentOperationsError::Internal)?
            else {
                continue;
            };
            children.push(
                self.project_roster_entry(&parent, child_record, link, completions)
                    .await?,
            );
        }
        Ok(SubagentParentRoster {
            parent: parent_view,
            children,
        })
    }

    async fn project_roster_entry(
        &self,
        parent: &ResolvedAgent,
        child_record: SessionRecord,
        link: SessionLinkRecord,
        completions: &HashMap<String, SubagentCompletionRecord>,
    ) -> Result<SubagentRosterEntry, AgentOperationsError> {
        let child = ResolvedAgent {
            record: child_record,
            parent_link: Some(link.clone()),
        };
        let agent = self.project_agent(&child, Some(parent)).await?;
        let latest_completion = completions.get(&link.id).map(subagent_completion_view);
        Ok(SubagentRosterEntry {
            agent,
            relationship: relationship_view(link),
            latest_completion,
        })
    }
}

pub(super) fn relationship_view(link: SessionLinkRecord) -> SubagentRelationshipView {
    SubagentRelationshipView {
        subagent_id: link.public_id,
        session_link_id: link.id,
        parent_session_id: link.parent_session_id,
        child_session_id: link.child_session_id,
        label: link.label,
        created_at: link.created_at,
        subagent_closed_at: link.subagent_closed_at,
    }
}

fn subagent_completion_view(completion: &SubagentCompletionRecord) -> SubagentLatestCompletionView {
    SubagentLatestCompletionView {
        completion_id: completion.completion_id.clone(),
        child_turn_id: completion.child_turn_id.clone(),
        outcome: completion.outcome,
        child_last_event_seq: completion.child_last_event_seq,
        created_at: completion.created_at.clone(),
    }
}
