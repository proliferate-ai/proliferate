use super::model::{
    normalized_session_status, ChildSubagentContext, ParentSubagentLinkContext,
    SessionSubagentsContext, SubagentCompletionRecord, SubagentEventSlice, SubagentLatestTurn,
    SubagentSummary, SubagentTranscriptSearchMatch, SubagentWakeScheduleRecord,
};
use super::store::{SubagentCompletionInsert, SubagentStore};
use super::summary::completion_to_summary;
use crate::domains::sessions::delegation::read_child_events;
use crate::domains::sessions::transcript_read::{
    search_session_transcript, summarize_turn_events, LATEST_TURN_EVENT_BUDGET,
    READ_LATEST_TURNS_DEFAULT_LIMIT, READ_LATEST_TURNS_MAX_LIMIT,
};
use crate::domains::sessions::deletion::SessionDeleteWorkflow;
use crate::domains::sessions::links::model::{
    SessionLinkRecord, SessionLinkRelation, SessionLinkWorkspaceRelation,
};
use crate::domains::sessions::links::service::{
    CreateSessionLinkError, CreateSessionLinkInput, SessionLinkService,
};
use crate::domains::sessions::model::SessionRecord;
use crate::domains::sessions::prompt::PromptPayload;
use crate::domains::sessions::store::SessionStore;
use crate::domains::workspaces::access_gate::{WorkspaceAccessError, WorkspaceAccessGate};
use crate::domains::workspaces::model::WorkspaceSurface;
use crate::domains::workspaces::runtime::WorkspaceRuntime;
use std::collections::HashSet;

pub const MAX_SUBAGENTS_PER_PARENT: usize = 8;

#[derive(Debug, thiserror::Error)]
pub enum SubagentError {
    #[error("parent session not found: {0}")]
    ParentNotFound(String),
    #[error("child session not found: {0}")]
    ChildNotFound(String),
    #[error("workspace not found: {0}")]
    WorkspaceNotFound(String),
    #[error("subagents are only available in standard workspaces")]
    IneligibleWorkspace,
    #[error("subagent child must be in the same workspace")]
    CrossWorkspace,
    #[error("subagent children cannot create subagents")]
    DepthLimit,
    #[error("a subagent cannot spawn agents of its own until it is promoted")]
    Subordinate,
    #[error("subagents are disabled for this session")]
    Disabled,
    #[error("parent already has the maximum number of subagents")]
    FanoutLimit,
    #[error("child session is not owned by parent")]
    NotOwned,
    #[error("subagent target is required")]
    TargetRequired,
    #[error("subagentId and childSessionId refer to different subagents")]
    ConflictingTarget,
    #[error("subagent is closed")]
    Closed,
    #[error("workspace mutation blocked: {0}")]
    MutationBlocked(String),
    #[error(transparent)]
    Link(#[from] CreateSessionLinkError),
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

#[derive(Clone)]
pub struct SubagentService {
    session_store: SessionStore,
    delete_workflow: SessionDeleteWorkflow,
    link_service: SessionLinkService,
    subagent_store: SubagentStore,
    workspace_runtime: std::sync::Arc<WorkspaceRuntime>,
    access_gate: std::sync::Arc<WorkspaceAccessGate>,
}

impl SubagentService {
    pub fn new(
        session_store: SessionStore,
        delete_workflow: SessionDeleteWorkflow,
        link_service: SessionLinkService,
        subagent_store: SubagentStore,
        workspace_runtime: std::sync::Arc<WorkspaceRuntime>,
        access_gate: std::sync::Arc<WorkspaceAccessGate>,
    ) -> Self {
        Self {
            session_store,
            delete_workflow,
            link_service,
            subagent_store,
            workspace_runtime,
            access_gate,
        }
    }

    /// The prechecks every agent creation shares, whatever the caller ends up
    /// owning: the caller exists and is still open, its workspace is a standard
    /// one, and creating agents is enabled for that session.
    ///
    /// What is deliberately NOT here is everything about SUBORDINATION — the
    /// depth rule and the fanout cap — because those describe a linked
    /// subagent, not a peer the caller merely owns (ADR §3.4, ruling 9).
    fn validate_caller_can_create(
        &self,
        caller_session_id: &str,
    ) -> Result<SessionRecord, SubagentError> {
        let caller = self
            .session_store
            .find_by_id(caller_session_id)?
            .ok_or_else(|| SubagentError::ParentNotFound(caller_session_id.to_string()))?;
        if caller.closed_at.is_some() || caller.status == "closed" {
            return Err(SubagentError::Closed);
        }
        let workspace = self
            .workspace_runtime
            .get_workspace(&caller.workspace_id)?
            .ok_or_else(|| SubagentError::WorkspaceNotFound(caller.workspace_id.clone()))?;
        if workspace.surface != WorkspaceSurface::Standard {
            return Err(SubagentError::IneligibleWorkspace);
        }
        // `spawn_subagent` creates every child with `subagents_enabled = false`;
        // that flag is how a spawned child carries its subordination, and it is
        // the only server-side consumer of the flag (agent ops mounts on every
        // session, and this validation is recomputed per call). So promotion has
        // to lift it too, or ruling 7 never takes effect for any real child.
        // Derived from `promoted_at` rather than rewriting the session row, so
        // promotion stays ONE durable fact on the link instead of two rows in
        // two tables that can diverge.
        let ownership = self.link_service.find_subagent_parent(caller_session_id)?;
        let is_promoted_child = ownership
            .as_ref()
            .is_some_and(|link| link.promoted_at.is_some());
        if !caller.subagents_enabled && !is_promoted_child {
            return Err(SubagentError::Disabled);
        }
        Ok(caller)
    }

    /// The `spawn_agent` form of [`Self::validate_parent_can_spawn`].
    ///
    /// What the two forms do NOT share is everything the fanout cap and the
    /// depth rule say about the agent being CREATED: an owned agent is a peer,
    /// ruling 9 puts no numeric limit on it, and it is subordinate to nobody,
    /// so a caller holding eight subagents may still spawn one. What they do
    /// share is every rule about the CALLER — including subordination, below —
    /// plus the workspace the new session lands in being mutable, which for
    /// this tool is the caller's own, the one whose write lease the route
    /// already took.
    ///
    /// Ruling 3's spawn block IS restated here, even though
    /// `agent_ops::calls::call_tool` already refuses an unpromoted subagent
    /// before dispatch reaches any tool body. The dispatch gate is where the
    /// refusal can say why; this is the gate that makes the capability itself
    /// false, so `can_spawn_agent` means what its name claims and the tool body
    /// refuses on its own rather than trusting one caller to have checked.
    /// Subordination is read exactly as the depth rule reads it — an open
    /// subagent link naming this session as the child, not yet promoted.
    pub fn validate_caller_can_spawn_agent(
        &self,
        caller_session_id: &str,
    ) -> Result<SessionRecord, SubagentError> {
        let caller = self.validate_caller_can_create(caller_session_id)?;
        if self
            .link_service
            .find_subagent_parent(caller_session_id)?
            .is_some_and(|link| link.is_unpromoted_subagent())
        {
            return Err(SubagentError::Subordinate);
        }
        self.access_gate
            .assert_can_mutate_for_workspace(&caller.workspace_id)
            .map_err(map_access_error)?;
        Ok(caller)
    }

    pub fn validate_parent_can_spawn(
        &self,
        parent_session_id: &str,
    ) -> Result<SessionRecord, SubagentError> {
        let parent = self.validate_caller_can_create(parent_session_id)?;
        // Depth is capped at one level of subordination, and promotion is
        // exactly what lifts it (ADR §3.3): a promoted agent is a peer, so it
        // may spawn its own children even though its ownership row survives.
        // (`validate_caller_can_create` already lifted `subagents_enabled` for
        // a promoted child from the same link.)
        let ownership = self.link_service.find_subagent_parent(parent_session_id)?;
        if ownership.is_some_and(|link| link.is_unpromoted_subagent()) {
            return Err(SubagentError::DepthLimit);
        }
        if self
            .link_service
            .find_parent_by_relation(SessionLinkRelation::CoworkCodingSession, parent_session_id)?
            .is_some()
        {
            return Err(SubagentError::DepthLimit);
        }
        // Promoted children no longer occupy one of the parent's slots — the
        // cap bounds concurrent subordinates, not lifetime descendants. One
        // predicate serves the pre-check here, the advertised limits in the
        // agent-ops context, and the store's own subselect in
        // `create_subagent_link_with_child_limit`, which is the real cap.
        if self.count_occupied_subagent_slots(parent_session_id)? >= MAX_SUBAGENTS_PER_PARENT {
            return Err(SubagentError::FanoutLimit);
        }
        self.access_gate
            .assert_can_mutate_for_workspace(&parent.workspace_id)
            .map_err(map_access_error)?;
        Ok(parent)
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

    pub fn authorize_child(
        &self,
        parent_session_id: &str,
        child_session_id: &str,
    ) -> Result<SessionLinkRecord, SubagentError> {
        self.link_service
            .find_subagent_link(parent_session_id, child_session_id)?
            .ok_or(SubagentError::NotOwned)
    }

    pub fn authorize_target(
        &self,
        parent_session_id: &str,
        subagent_id: Option<&str>,
        child_session_id: Option<&str>,
    ) -> Result<SessionLinkRecord, SubagentError> {
        let link = self.resolve_target(parent_session_id, subagent_id, child_session_id, false)?;
        if link.closed_at.is_some() {
            return Err(SubagentError::Closed);
        }
        Ok(link)
    }

    pub fn resolve_target_including_closed(
        &self,
        parent_session_id: &str,
        subagent_id: Option<&str>,
        child_session_id: Option<&str>,
    ) -> Result<SessionLinkRecord, SubagentError> {
        self.resolve_target(parent_session_id, subagent_id, child_session_id, true)
    }

    fn resolve_target(
        &self,
        parent_session_id: &str,
        subagent_id: Option<&str>,
        child_session_id: Option<&str>,
        include_closed: bool,
    ) -> Result<SessionLinkRecord, SubagentError> {
        let subagent_id = subagent_id.map(str::trim).filter(|value| !value.is_empty());
        let child_session_id = child_session_id
            .map(str::trim)
            .filter(|value| !value.is_empty());
        if subagent_id.is_none() && child_session_id.is_none() {
            return Err(SubagentError::TargetRequired);
        }

        let link = if let Some(public_id) = subagent_id {
            self.link_service
                .find_by_public_id(public_id)?
                .filter(|link| {
                    link.relation == SessionLinkRelation::Subagent
                        && link.parent_session_id == parent_session_id
                })
                .ok_or(SubagentError::NotOwned)?
        } else {
            let child_id = child_session_id.expect("checked above");
            if include_closed {
                self.link_service
                    .find_link_by_relation_including_closed(
                        SessionLinkRelation::Subagent,
                        parent_session_id,
                        child_id,
                    )?
                    .ok_or(SubagentError::NotOwned)?
            } else {
                self.authorize_child(parent_session_id, child_id)?
            }
        };

        if let Some(child_id) = child_session_id {
            if link.child_session_id != child_id {
                return Err(SubagentError::ConflictingTarget);
            }
        }
        Ok(link)
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
                promoted_at: link.promoted_at,
                closed_by_session_id: link.closed_by_session_id,
                close_reason: link.close_reason,
            });
        }
        Ok(summaries)
    }

    pub fn subagent_context(
        &self,
        session_id: &str,
    ) -> Result<SessionSubagentsContext, SubagentError> {
        self.session_store
            .find_by_id(session_id)?
            .ok_or_else(|| SubagentError::ParentNotFound(session_id.to_string()))?;

        let parent = if let Some(link) = self.link_service.find_subagent_parent(session_id)? {
            self.session_store
                .find_by_id(&link.parent_session_id)?
                .map(|parent| ParentSubagentLinkContext {
                    subagent_id: link.public_id.clone(),
                    session_link_id: link.id,
                    parent_session_id: parent.id,
                    parent_title: parent.title,
                    parent_agent_kind: parent.agent_kind,
                    parent_model_id: parent.current_model_id.or(parent.requested_model_id),
                    label: link.label,
                    link_created_at: link.created_at,
                    link_closed_at: link.closed_at,
                })
        } else {
            None
        };

        let links = self.link_service.list_subagent_children(session_id)?;
        let link_ids = links.iter().map(|link| link.id.clone()).collect::<Vec<_>>();
        let scheduled_link_ids = self
            .subagent_store
            .list_wake_schedules(&link_ids)?
            .into_iter()
            .map(|schedule| schedule.session_link_id)
            .collect::<HashSet<_>>();

        let mut children = Vec::new();
        for link in links {
            let Some(child) = self.session_store.find_by_id(&link.child_session_id)? else {
                continue;
            };
            let latest_completion = self
                .subagent_store
                .latest_completion_for_link(&link.id)?
                .map(completion_to_summary);
            let wake_scheduled = scheduled_link_ids.contains(&link.id);
            children.push(ChildSubagentContext {
                subagent_id: link.public_id.clone(),
                session_link_id: link.id,
                child_session_id: child.id.clone(),
                title: child.title.clone(),
                label: link.label,
                status: normalized_session_status(&child.status).to_string(),
                agent_kind: child.agent_kind,
                model_id: child.current_model_id.or(child.requested_model_id),
                mode_id: child.current_mode_id.or(child.requested_mode_id),
                link_created_at: link.created_at,
                link_closed_at: link.closed_at,
                child_created_at: child.created_at,
                latest_completion,
                wake_scheduled,
            });
        }

        Ok(SessionSubagentsContext { parent, children })
    }

    pub fn find_subagent_parent(
        &self,
        child_session_id: &str,
    ) -> anyhow::Result<Option<SessionLinkRecord>> {
        self.link_service.find_subagent_parent(child_session_id)
    }

    /// How many of this parent's eight subagent slots are taken right now.
    ///
    /// Promoted children are excluded, because they no longer occupy a slot —
    /// and because the store's insert subselect excludes them, so any other
    /// count would advertise a cap that `spawn_subagent` does not enforce.
    pub fn count_occupied_subagent_slots(
        &self,
        parent_session_id: &str,
    ) -> anyhow::Result<usize> {
        self.link_service
            .count_open_unpromoted_subagent_children(parent_session_id)
    }

    /// The link service this subagent service already holds. The peer tools
    /// need it for ownership-row reads (an end-requested target takes no new
    /// messages) that have nothing to do with the caller's own link tree.
    pub fn link_service(&self) -> &SessionLinkService {
        &self.link_service
    }

    /// Batched form of [`Self::find_subagent_parent`] for a page of sessions.
    pub fn find_subagent_parents(
        &self,
        child_session_ids: &[String],
    ) -> anyhow::Result<Vec<SessionLinkRecord>> {
        self.link_service.find_subagent_parents(child_session_ids)
    }

    pub fn session_store(&self) -> &SessionStore {
        &self.session_store
    }

    /// The workspace access gate this service already holds — the peer send
    /// needs it for the TARGET workspace, which the route layer never sees.
    pub fn access_gate(&self) -> &WorkspaceAccessGate {
        &self.access_gate
    }

    pub fn delete_session(&self, session_id: &str) -> anyhow::Result<()> {
        self.delete_workflow.delete_session(session_id)
    }

    pub fn insert_completion_and_consume_schedule(
        &self,
        record: &SubagentCompletionRecord,
        parent_session_id: &str,
        wake_prompt: &PromptPayload,
    ) -> anyhow::Result<Option<SubagentCompletionInsert>> {
        self.subagent_store.insert_completion_and_consume_schedule(
            record,
            parent_session_id,
            wake_prompt,
        )
    }

    pub fn schedule_wake_for_child(
        &self,
        parent_session_id: &str,
        child_session_id: &str,
    ) -> Result<(SessionLinkRecord, bool), SubagentError> {
        let link = self.authorize_child(parent_session_id, child_session_id)?;
        let child = self
            .session_store
            .find_by_id(child_session_id)?
            .ok_or_else(|| SubagentError::ChildNotFound(child_session_id.to_string()))?;
        self.access_gate
            .assert_can_mutate_for_workspace(&child.workspace_id)
            .map_err(map_access_error)?;
        let inserted = self.subagent_store.schedule_wake(&link.id)?;
        Ok((link, inserted))
    }

    pub fn schedule_wake_for_target(
        &self,
        parent_session_id: &str,
        subagent_id: Option<&str>,
        child_session_id: Option<&str>,
    ) -> Result<(SessionLinkRecord, bool), SubagentError> {
        let link = self.authorize_target(parent_session_id, subagent_id, child_session_id)?;
        let child = self
            .session_store
            .find_by_id(&link.child_session_id)?
            .ok_or_else(|| SubagentError::ChildNotFound(link.child_session_id.clone()))?;
        self.access_gate
            .assert_can_mutate_for_workspace(&child.workspace_id)
            .map_err(map_access_error)?;
        let inserted = self.subagent_store.schedule_wake(&link.id)?;
        Ok((link, inserted))
    }

    pub fn close_link(&self, link: &SessionLinkRecord, closed_at: &str) -> anyhow::Result<bool> {
        self.link_service.close_link(&link.id, closed_at)
    }

    pub fn delete_wake_schedule_for_link(&self, session_link_id: &str) -> anyhow::Result<bool> {
        self.subagent_store.delete_wake_schedule(session_link_id)
    }

    pub fn mark_parent_event_seq(&self, completion_id: &str, seq: i64) -> anyhow::Result<()> {
        self.subagent_store
            .mark_parent_event_seq(completion_id, seq)
    }

    pub fn read_subagent_events(
        &self,
        parent_session_id: &str,
        subagent_id: Option<&str>,
        child_session_id: Option<&str>,
        since_seq: Option<i64>,
        limit: Option<usize>,
    ) -> Result<SubagentEventSlice, SubagentError> {
        let link =
            self.resolve_target_including_closed(parent_session_id, subagent_id, child_session_id)?;
        let slice = read_child_events(
            &self.session_store,
            &self.link_service,
            SessionLinkRelation::Subagent,
            parent_session_id,
            &link.child_session_id,
            since_seq,
            limit,
        )?;
        Ok(SubagentEventSlice {
            child_session_id: slice.child_session_id,
            events: slice.events,
            next_since_seq: slice.next_since_seq,
            truncated: slice.truncated,
        })
    }

    pub fn read_latest_turns(
        &self,
        parent_session_id: &str,
        subagent_id: Option<&str>,
        child_session_id: Option<&str>,
        limit: Option<usize>,
    ) -> Result<Vec<SubagentLatestTurn>, SubagentError> {
        let link =
            self.resolve_target_including_closed(parent_session_id, subagent_id, child_session_id)?;
        let limit = limit
            .unwrap_or(READ_LATEST_TURNS_DEFAULT_LIMIT)
            .clamp(1, READ_LATEST_TURNS_MAX_LIMIT);
        let mut completions = self
            .subagent_store
            .list_completions_for_links(std::slice::from_ref(&link.id))?;
        completions.sort_by(|left, right| {
            right
                .created_at
                .cmp(&left.created_at)
                .then_with(|| right.completion_id.cmp(&left.completion_id))
        });
        completions.truncate(limit);
        completions.reverse();

        let event_records = self.session_store.list_events_for_latest_turns(
            &link.child_session_id,
            limit as i64,
            LATEST_TURN_EVENT_BUDGET,
        )?;
        let mut turns = Vec::with_capacity(completions.len());
        for completion in completions {
            let turn_events = event_records
                .iter()
                .filter(|record| {
                    record.turn_id.as_deref() == Some(completion.child_turn_id.as_str())
                })
                .cloned()
                .collect::<Vec<_>>();
            let (assistant_text, tool_errors) = summarize_turn_events(&turn_events);
            turns.push(SubagentLatestTurn {
                child_turn_id: completion.child_turn_id,
                outcome: completion.outcome.as_str().to_string(),
                created_at: completion.created_at,
                child_last_event_seq: completion.child_last_event_seq,
                assistant_text,
                tool_errors,
                event_count: turn_events.len(),
            });
        }
        Ok(turns)
    }

    pub fn search_transcript(
        &self,
        parent_session_id: &str,
        subagent_id: Option<&str>,
        child_session_id: Option<&str>,
        query: &str,
        limit: Option<usize>,
    ) -> Result<Vec<SubagentTranscriptSearchMatch>, SubagentError> {
        let link =
            self.resolve_target_including_closed(parent_session_id, subagent_id, child_session_id)?;
        search_session_transcript(&self.session_store, &link.child_session_id, query, limit)
            .map_err(SubagentError::Internal)
    }

    pub fn mobility_graph_for_sessions(
        &self,
        session_ids: &HashSet<String>,
    ) -> anyhow::Result<(
        Vec<SessionLinkRecord>,
        Vec<SubagentCompletionRecord>,
        Vec<SubagentWakeScheduleRecord>,
        Vec<String>,
    )> {
        let mut links = Vec::new();
        let mut blockers = Vec::new();
        for session_id in session_ids {
            for link in self
                .link_service
                .list_by_parent_including_closed(session_id)?
            {
                if session_ids.contains(&link.child_session_id) {
                    links.push(link);
                } else if link.closed_at.is_none() {
                    blockers.push(link.child_session_id);
                }
            }
            for link in self
                .link_service
                .list_by_child_including_closed(session_id)?
            {
                if !session_ids.contains(&link.parent_session_id) && link.closed_at.is_none() {
                    blockers.push(link.parent_session_id);
                }
            }
        }
        links.sort_by(|left, right| left.id.cmp(&right.id));
        links.dedup_by(|left, right| left.id == right.id);
        let link_ids = links.iter().map(|link| link.id.clone()).collect::<Vec<_>>();
        let completions = self.subagent_store.list_completions_for_links(&link_ids)?;
        let schedules = self.subagent_store.list_wake_schedules(&link_ids)?;
        Ok((links, completions, schedules, blockers))
    }

    pub fn import_completion(&self, completion: &SubagentCompletionRecord) -> anyhow::Result<()> {
        self.subagent_store.import_completion(completion)
    }

    pub fn import_wake_schedule(
        &self,
        schedule: &SubagentWakeScheduleRecord,
    ) -> anyhow::Result<()> {
        self.subagent_store
            .import_wake_schedule(&schedule.session_link_id)
    }

    pub fn import_link(&self, link: &SessionLinkRecord) -> anyhow::Result<()> {
        self.link_service.import_link(link)
    }
}

fn map_access_error(error: WorkspaceAccessError) -> SubagentError {
    SubagentError::MutationBlocked(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::test_support;
    use crate::domains::sessions::model::SessionMcpBindingPolicy;
    use crate::persistence::Db;

    /// `spawn_subagent` creates every child with `subagents_enabled = false`;
    /// a human-created session carries the user's preference.
    fn session_record(id: &str, subagents_enabled: bool) -> SessionRecord {
        SessionRecord {
            id: id.to_string(),
            workspace_id: "workspace-1".to_string(),
            agent_kind: "claude".to_string(),
            native_session_id: None,
            agent_auth_contexts: None,
            requested_model_id: None,
            current_model_id: None,
            requested_mode_id: None,
            current_mode_id: None,
            title: Some(format!("Agent {id}")),
            thinking_level_id: None,
            thinking_budget_tokens: None,
            status: "idle".to_string(),
            created_at: "2026-08-08T00:00:00Z".to_string(),
            updated_at: "2026-08-08T00:00:00Z".to_string(),
            last_prompt_at: None,
            closed_at: None,
            dismissed_at: None,
            mcp_bindings_ciphertext: None,
            mcp_binding_summaries_json: None,
            mcp_binding_policy: SessionMcpBindingPolicy::InheritWorkspace,
            system_prompt_append: None,
            subagents_enabled,
            action_capabilities_json: None,
            origin: None,
        }
    }

    fn fixture(session_ids: &[&str]) -> test_support::SubagentServiceFixture {
        let db = Db::open_in_memory().expect("open db");
        test_support::seed_workspace_with_repo_root(&db, "workspace-1", "local", "/tmp/workspace-1");
        let fixture = test_support::subagent_service_fixture(&db);
        for id in session_ids {
            fixture
                .sessions
                .insert(&session_record(id, true))
                .expect("insert session");
        }
        fixture
    }

    /// Ruling 7 / ADR §3.3: promotion makes a child a peer, and a peer spawns.
    /// The depth lift alone does not deliver that — a spawned child is born with
    /// `subagents_enabled = false`, which refuses first — so promotion has to
    /// lift the born-with block as well or it lifts nothing that exists.
    #[test]
    fn promotion_lets_a_spawned_child_spawn_its_own_agents() {
        let fixture = fixture(&["ses_parent"]);
        // Exactly how `spawn_subagent` creates a child.
        fixture
            .sessions
            .insert(&session_record("ses_child", false))
            .expect("insert child");
        fixture
            .sessions
            .insert(&session_record("ses_sibling", false))
            .expect("insert sibling");
        let child_link = fixture
            .service
            .link_child("ses_parent", "ses_child", None, None, None)
            .expect("link the child")
            .id;
        fixture
            .service
            .link_child("ses_parent", "ses_sibling", None, None, None)
            .expect("link the sibling");

        // Before promotion the child is subordinate and cannot spawn.
        assert!(matches!(
            fixture.service.validate_parent_can_spawn("ses_child"),
            Err(SubagentError::Disabled)
        ));

        assert!(fixture
            .links
            .promote_link(&child_link, "2026-08-08T01:00:00Z")
            .expect("promote the child"));

        fixture
            .service
            .validate_parent_can_spawn("ses_child")
            .expect("a promoted agent is a peer and may spawn its own children");

        // Negative control: promotion lifted the block for the promoted row
        // only. The sibling, still owned, is still refused — so the assertion
        // above is the promotion and not a blanket removal of the check.
        assert!(matches!(
            fixture.service.validate_parent_can_spawn("ses_sibling"),
            Err(SubagentError::Disabled)
        ));
    }

    /// The lift is scoped to promoted children: a session whose owner never
    /// promoted it, and an ordinary session whose user turned subagents off,
    /// both keep the refusal.
    #[test]
    fn a_session_with_subagents_switched_off_is_still_refused() {
        let fixture = fixture(&[]);
        fixture
            .sessions
            .insert(&session_record("ses_solo_off", false))
            .expect("insert session");
        fixture
            .sessions
            .insert(&session_record("ses_solo_on", true))
            .expect("insert session");

        assert!(matches!(
            fixture.service.validate_parent_can_spawn("ses_solo_off"),
            Err(SubagentError::Disabled)
        ));

        // Non-vacuity: an otherwise identical session with the preference on
        // passes every gate in this validation, so `Disabled` above is the flag
        // and not some other refusal in the fixture.
        fixture
            .service
            .validate_parent_can_spawn("ses_solo_on")
            .expect("an ordinary session with subagents enabled may spawn");
    }

    #[test]
    fn an_unpromoted_subagent_may_not_spawn_a_peer_either() {
        // Ruling 3 is about SUBORDINATION, not about which spawn tool is being
        // called: a session that may not create a subagent may not create a
        // peer that outlives its parent either. Enforced here rather than only
        // at `call_tool` so `can_spawn_agent` is false for the caller and the
        // tool body refuses on its own — any future path into
        // `calls::spawn_agent` that skips the dispatch gate still stops.
        let fixture = fixture(&["ses_owner", "ses_subagent"]);
        let link = fixture
            .service
            .link_child("ses_owner", "ses_subagent", None, None, None)
            .expect("link the subagent");

        let error = fixture
            .service
            .validate_caller_can_spawn_agent("ses_subagent")
            .err()
            .expect("a subordinate caller may not spawn");
        assert!(matches!(error, SubagentError::Subordinate));
        // The same caller is refused `spawn_subagent` for the same reason, so
        // the two spawn tools now have the same answer to subordination.
        assert!(matches!(
            fixture
                .service
                .validate_parent_can_spawn("ses_subagent")
                .err()
                .expect("a subordinate caller may not spawn a subagent either"),
            SubagentError::DepthLimit
        ));

        // Promotion is exactly what lifts it — the link stays, the block goes.
        assert!(fixture
            .links
            .promote_link(&link.id, "2026-08-08T01:00:00Z")
            .expect("promote"));
        fixture
            .service
            .validate_caller_can_spawn_agent("ses_subagent")
            .expect("a promoted agent is a peer and may spawn");
    }

    #[test]
    fn a_top_level_caller_may_spawn_a_peer() {
        // The negative control for the check above: no subagent link, no
        // refusal. Without this the test above would pass just as well if
        // `validate_caller_can_spawn_agent` refused everybody.
        let fixture = fixture(&["ses_owner"]);

        fixture
            .service
            .validate_caller_can_spawn_agent("ses_owner")
            .expect("a top-level caller may spawn a peer");
    }

    #[test]
    fn the_fanout_cap_does_not_reach_the_peer_spawn_gate() {
        // Ruling 9 at the seam that decides it. An owner holding the maximum
        // number of subagents is refused another subagent and still allowed a
        // peer: the cap bounds subordinates, and a peer is not one. Pinned
        // here because the split between the two validators is the only thing
        // keeping the cap out — reinstating it inside
        // `validate_caller_can_create` would be invisible from the tool list.
        let mut ids = vec!["ses_owner".to_string()];
        for index in 0..MAX_SUBAGENTS_PER_PARENT {
            ids.push(format!("ses_child_{index}"));
        }
        let borrowed: Vec<&str> = ids.iter().map(String::as_str).collect();
        let fixture = fixture(&borrowed);
        for index in 0..MAX_SUBAGENTS_PER_PARENT {
            fixture
                .service
                .link_child("ses_owner", &format!("ses_child_{index}"), None, None, None)
                .expect("link a subagent");
        }

        assert!(matches!(
            fixture
                .service
                .validate_parent_can_spawn("ses_owner")
                .err()
                .expect("the ninth subagent is refused"),
            SubagentError::FanoutLimit
        ));
        fixture
            .service
            .validate_caller_can_spawn_agent("ses_owner")
            .expect("a capped owner may still spawn a peer");
    }

    #[test]
    fn a_closed_caller_may_not_spawn_a_peer() {
        // The prechecks both validators share still apply to the peer path;
        // this is the one that says the split did not drop them.
        let fixture = fixture(&["ses_owner"]);
        fixture
            .sessions
            .update_status("ses_owner", "closed", "2026-08-08T02:00:00Z")
            .expect("mark closed");

        assert!(matches!(
            fixture
                .service
                .validate_caller_can_spawn_agent("ses_owner")
                .err()
                .expect("a closed caller may not spawn"),
            SubagentError::Closed
        ));
    }
}
