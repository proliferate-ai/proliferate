use super::model::{SubagentCompletionRecord, SubagentSummary};
use crate::domains::sessions::links::completions::LinkCompletionStore;
use crate::domains::sessions::links::model::{
    SessionLinkRecord, SessionLinkRelation, SessionLinkWorkspaceRelation,
};
use crate::domains::sessions::links::service::{
    CreateSessionLinkError, CreateSessionLinkInput, SessionLinkService,
};
use crate::domains::sessions::store::SessionStore;

use std::collections::BTreeMap;

pub const MAX_SUBAGENTS_PER_PARENT: usize = 8;

#[derive(Debug, thiserror::Error)]
pub enum SubagentError {
    #[error("parent session not found: {0}")]
    ParentNotFound(String),
    #[error("child session not found: {0}")]
    ChildNotFound(String),
    #[error("subagent child must be in the same workspace")]
    CrossWorkspace,
    #[error("parent already has the maximum number of subagents")]
    FanoutLimit,
    #[error(transparent)]
    Link(#[from] CreateSessionLinkError),
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

#[derive(Clone)]
pub struct SubagentService {
    session_store: SessionStore,
    link_service: SessionLinkService,
    completion_store: LinkCompletionStore,
}

impl SubagentService {
    pub fn new(
        session_store: SessionStore,
        link_service: SessionLinkService,
        completion_store: LinkCompletionStore,
    ) -> Self {
        Self {
            session_store,
            link_service,
            completion_store,
        }
    }

    pub fn link_child(
        &self,
        parent_session_id: &str,
        child_session_id: &str,
        label: Option<String>,
        created_by_turn_id: Option<String>,
        created_by_tool_call_id: Option<String>,
    ) -> Result<SessionLinkRecord, SubagentError> {
        let parent = self
            .session_store
            .find_by_id(parent_session_id)?
            .ok_or_else(|| SubagentError::ParentNotFound(parent_session_id.to_string()))?;
        let child = self
            .session_store
            .find_by_id(child_session_id)?
            .ok_or_else(|| SubagentError::ChildNotFound(child_session_id.to_string()))?;
        if parent.workspace_id != child.workspace_id {
            return Err(SubagentError::CrossWorkspace);
        }
        let input = CreateSessionLinkInput {
            relation: SessionLinkRelation::Subagent,
            parent_session_id: parent_session_id.to_string(),
            child_session_id: child_session_id.to_string(),
            workspace_relation: SessionLinkWorkspaceRelation::SameWorkspace,
            label,
            created_by_turn_id,
            created_by_tool_call_id,
        };
        self.link_service
            .create_subagent_link_with_child_limit(input, MAX_SUBAGENTS_PER_PARENT)
            .map_err(|error| match error {
                CreateSessionLinkError::FanoutLimit => SubagentError::FanoutLimit,
                other => SubagentError::Link(other),
            })
    }

    pub fn list_subagents(
        &self,
        parent_session_id: &str,
    ) -> Result<Vec<SubagentSummary>, SubagentError> {
        let links = self
            .link_service
            .list_subagent_children(parent_session_id)?;
        let mut summaries = Vec::with_capacity(links.len());
        for link in links {
            let Some(child) = self.session_store.find_by_id(&link.child_session_id)? else {
                continue;
            };
            summaries.push(SubagentSummary {
                subagent_id: link.public_id.clone(),
                link_id: link.id,
                child_session_id: child.id,
                label: link.label,
                status: child.status,
                agent_kind: child.agent_kind,
                model_id: child.current_model_id.or(child.requested_model_id),
                mode_id: child.current_mode_id.or(child.requested_mode_id),
                created_at: child.created_at,
                closed_at: link.closed_at,
            });
        }
        Ok(summaries)
    }

    pub fn find_subagent_parent(
        &self,
        child_session_id: &str,
    ) -> anyhow::Result<Option<SessionLinkRecord>> {
        self.link_service.find_subagent_parent(child_session_id)
    }

    pub fn latest_completions_for_links(
        &self,
        link_ids: &[String],
    ) -> anyhow::Result<Vec<SubagentCompletionRecord>> {
        let mut latest = BTreeMap::new();
        for completion in self.completion_store.list_completions_for_links(link_ids)? {
            latest.insert(completion.session_link_id.clone(), completion);
        }
        Ok(latest.into_values().collect())
    }
}
