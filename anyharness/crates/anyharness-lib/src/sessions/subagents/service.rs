use std::collections::HashSet;

use anyharness_contract::v1::{
    ChildSubagentSummary, ContentPart, ParentSubagentLinkSummary, SessionEvent,
    SessionSubagentsResponse, SubagentCompletionSummary, SubagentTurnOutcome, TranscriptItemKind,
    TranscriptItemStatus,
};

use super::model::{
    SubagentCompletionRecord, SubagentEventSlice, SubagentLatestTurn, SubagentSummary,
    SubagentTranscriptSearchMatch, SubagentWakeScheduleRecord,
};
use super::store::{SubagentCompletionInsert, SubagentStore};
use crate::sessions::delegation::read_child_events;
use crate::sessions::extensions::SessionTurnOutcome;
use crate::sessions::links::model::{SessionLinkRelation, SessionLinkWorkspaceRelation};
use crate::sessions::links::service::{
    CreateSessionLinkError, CreateSessionLinkInput, SessionLinkService,
};
use crate::sessions::model::SessionRecord;
use crate::sessions::prompt::{PromptPayload, PromptProvenance};
use crate::sessions::store::SessionStore;
use crate::workspaces::access_gate::{WorkspaceAccessError, WorkspaceAccessGate};
use crate::workspaces::runtime::WorkspaceRuntime;

pub const MAX_SUBAGENTS_PER_PARENT: usize = 8;
pub const READ_LATEST_TURNS_DEFAULT_LIMIT: usize = 3;
pub const READ_LATEST_TURNS_MAX_LIMIT: usize = 10;
pub const SEARCH_TRANSCRIPT_DEFAULT_LIMIT: usize = 10;
pub const SEARCH_TRANSCRIPT_MAX_LIMIT: usize = 25;
const LATEST_TURN_EVENT_BUDGET: i64 = 200;
const SEARCH_EVENT_BUDGET: i64 = 500;
const ASSISTANT_TEXT_MAX_CHARS: usize = 4_000;
const SEARCH_SNIPPET_CONTEXT_CHARS: usize = 120;

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
    link_service: SessionLinkService,
    subagent_store: SubagentStore,
    workspace_runtime: std::sync::Arc<WorkspaceRuntime>,
    access_gate: std::sync::Arc<WorkspaceAccessGate>,
}

impl SubagentService {
    pub fn new(
        session_store: SessionStore,
        link_service: SessionLinkService,
        subagent_store: SubagentStore,
        workspace_runtime: std::sync::Arc<WorkspaceRuntime>,
        access_gate: std::sync::Arc<WorkspaceAccessGate>,
    ) -> Self {
        Self {
            session_store,
            link_service,
            subagent_store,
            workspace_runtime,
            access_gate,
        }
    }

    pub fn validate_parent_can_spawn(
        &self,
        parent_session_id: &str,
    ) -> Result<SessionRecord, SubagentError> {
        let parent = self
            .session_store
            .find_by_id(parent_session_id)?
            .ok_or_else(|| SubagentError::ParentNotFound(parent_session_id.to_string()))?;
        let workspace = self
            .workspace_runtime
            .get_workspace(&parent.workspace_id)?
            .ok_or_else(|| SubagentError::WorkspaceNotFound(parent.workspace_id.clone()))?;
        if workspace.surface != "standard" {
            return Err(SubagentError::IneligibleWorkspace);
        }
        if !parent.subagents_enabled {
            return Err(SubagentError::Disabled);
        }
        if self
            .link_service
            .find_subagent_parent(parent_session_id)?
            .is_some()
        {
            return Err(SubagentError::DepthLimit);
        }
        if self
            .link_service
            .find_parent_by_relation(SessionLinkRelation::CoworkCodingSession, parent_session_id)?
            .is_some()
        {
            return Err(SubagentError::DepthLimit);
        }
        if self
            .link_service
            .list_subagent_children(parent_session_id)?
            .len()
            >= MAX_SUBAGENTS_PER_PARENT
        {
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
    ) -> Result<crate::sessions::links::model::SessionLinkRecord, SubagentError> {
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
    ) -> Result<crate::sessions::links::model::SessionLinkRecord, SubagentError> {
        self.link_service
            .find_subagent_link(parent_session_id, child_session_id)?
            .ok_or(SubagentError::NotOwned)
    }

    pub fn authorize_target(
        &self,
        parent_session_id: &str,
        subagent_id: Option<&str>,
        child_session_id: Option<&str>,
    ) -> Result<crate::sessions::links::model::SessionLinkRecord, SubagentError> {
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
    ) -> Result<crate::sessions::links::model::SessionLinkRecord, SubagentError> {
        self.resolve_target(parent_session_id, subagent_id, child_session_id, true)
    }

    fn resolve_target(
        &self,
        parent_session_id: &str,
        subagent_id: Option<&str>,
        child_session_id: Option<&str>,
        include_closed: bool,
    ) -> Result<crate::sessions::links::model::SessionLinkRecord, SubagentError> {
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
            });
        }
        Ok(summaries)
    }

    pub fn subagent_context(
        &self,
        session_id: &str,
    ) -> Result<SessionSubagentsResponse, SubagentError> {
        self.session_store
            .find_by_id(session_id)?
            .ok_or_else(|| SubagentError::ParentNotFound(session_id.to_string()))?;

        let parent = if let Some(link) = self.link_service.find_subagent_parent(session_id)? {
            self.session_store
                .find_by_id(&link.parent_session_id)?
                .map(|parent| ParentSubagentLinkSummary {
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
                .map(completion_to_contract);
            let wake_scheduled = scheduled_link_ids.contains(&link.id);
            children.push(ChildSubagentSummary {
                subagent_id: link.public_id.clone(),
                session_link_id: link.id,
                child_session_id: child.id.clone(),
                title: child.title.clone(),
                label: link.label,
                status: child.to_contract().status,
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

        Ok(SessionSubagentsResponse { parent, children })
    }

    pub fn find_subagent_parent(
        &self,
        child_session_id: &str,
    ) -> anyhow::Result<Option<crate::sessions::links::model::SessionLinkRecord>> {
        self.link_service.find_subagent_parent(child_session_id)
    }

    pub fn session_store(&self) -> &SessionStore {
        &self.session_store
    }

    pub fn delete_session(&self, session_id: &str) -> anyhow::Result<()> {
        self.session_store.delete_session(session_id)
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
    ) -> Result<(crate::sessions::links::model::SessionLinkRecord, bool), SubagentError> {
        let link = self.authorize_child(parent_session_id, child_session_id)?;
        if link.closed_at.is_some() {
            return Err(SubagentError::Closed);
        }
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
    ) -> Result<(crate::sessions::links::model::SessionLinkRecord, bool), SubagentError> {
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

    pub fn close_link(
        &self,
        link: &crate::sessions::links::model::SessionLinkRecord,
        closed_at: &str,
    ) -> anyhow::Result<bool> {
        let _ = self.subagent_store.delete_wake_schedule(&link.id)?;
        self.link_service.mark_closed(&link.id, closed_at)
    }

    pub fn delete_wake_schedule_for_link(&self, session_link_id: &str) -> anyhow::Result<bool> {
        self.subagent_store.delete_wake_schedule(session_link_id)
    }

    pub fn mark_parent_event_seq(&self, completion_id: &str, seq: i64) -> anyhow::Result<()> {
        self.subagent_store
            .mark_parent_event_seq(completion_id, seq)
    }

    pub(crate) fn wake_prompt_provenance(
        session_link_id: &str,
        completion_id: &str,
        label: Option<String>,
    ) -> PromptProvenance {
        PromptProvenance::SubagentWake {
            session_link_id: session_link_id.to_string(),
            completion_id: completion_id.to_string(),
            label,
        }
    }

    pub(crate) fn parent_to_child_provenance(
        parent_session_id: &str,
        session_link_id: &str,
        label: Option<String>,
    ) -> PromptProvenance {
        PromptProvenance::AgentSession {
            source_session_id: parent_session_id.to_string(),
            session_link_id: Some(session_link_id.to_string()),
            label,
        }
    }

    pub fn read_subagent_events(
        &self,
        parent_session_id: &str,
        subagent_id: Option<&str>,
        child_session_id: Option<&str>,
        since_seq: Option<i64>,
        limit: Option<usize>,
    ) -> Result<SubagentEventSlice, SubagentError> {
        let link = self.authorize_target(parent_session_id, subagent_id, child_session_id)?;
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
        let link = self.authorize_target(parent_session_id, subagent_id, child_session_id)?;
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
        let link = self.authorize_target(parent_session_id, subagent_id, child_session_id)?;
        let query = query.trim();
        if query.is_empty() {
            return Err(SubagentError::Internal(anyhow::anyhow!(
                "query is required"
            )));
        }
        let limit = limit
            .unwrap_or(SEARCH_TRANSCRIPT_DEFAULT_LIMIT)
            .clamp(1, SEARCH_TRANSCRIPT_MAX_LIMIT);
        let needle = query.to_lowercase();
        let records = self
            .session_store
            .list_events_limited(&link.child_session_id, SEARCH_EVENT_BUDGET)?;
        let mut matches = Vec::new();
        for record in records {
            if matches.len() >= limit {
                break;
            }
            let text = transcript_search_text(&record);
            if text.is_empty() {
                continue;
            }
            if let Some(index) = text.to_lowercase().find(&needle) {
                matches.push(SubagentTranscriptSearchMatch {
                    seq: record.seq,
                    timestamp: record.timestamp,
                    turn_id: record.turn_id,
                    item_id: record.item_id,
                    snippet: make_snippet(&text, index, query.len()),
                });
            }
        }
        Ok(matches)
    }

    pub fn mobility_graph_for_sessions(
        &self,
        session_ids: &HashSet<String>,
    ) -> anyhow::Result<(
        Vec<crate::sessions::links::model::SessionLinkRecord>,
        Vec<SubagentCompletionRecord>,
        Vec<SubagentWakeScheduleRecord>,
        Vec<String>,
    )> {
        let mut links = Vec::new();
        let mut blockers = Vec::new();
        for session_id in session_ids {
            for link in self.link_service.list_by_parent(session_id)? {
                if session_ids.contains(&link.child_session_id) {
                    links.push(link);
                } else {
                    blockers.push(link.child_session_id);
                }
            }
            for link in self.link_service.list_by_child(session_id)? {
                if !session_ids.contains(&link.parent_session_id) {
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

    pub fn import_link(
        &self,
        link: &crate::sessions::links::model::SessionLinkRecord,
    ) -> anyhow::Result<()> {
        self.link_service.import_link(link)
    }
}

fn completion_to_contract(wake: SubagentCompletionRecord) -> SubagentCompletionSummary {
    SubagentCompletionSummary {
        completion_id: wake.completion_id,
        child_turn_id: wake.child_turn_id,
        outcome: match wake.outcome {
            SessionTurnOutcome::Completed => SubagentTurnOutcome::Completed,
            SessionTurnOutcome::Failed => SubagentTurnOutcome::Failed,
            SessionTurnOutcome::Cancelled => SubagentTurnOutcome::Cancelled,
        },
        child_last_event_seq: wake.child_last_event_seq,
        created_at: wake.created_at,
        parent_event_seq: wake.parent_event_seq,
        parent_prompt_seq: wake.parent_prompt_seq,
    }
}

pub fn public_subagent_id(
    link: &crate::sessions::links::model::SessionLinkRecord,
) -> Option<String> {
    link.public_id.clone()
}

fn summarize_turn_events(
    events: &[crate::sessions::model::SessionEventRecord],
) -> (Option<String>, Vec<String>) {
    let mut assistant = String::new();
    let mut tool_errors = Vec::new();
    for record in events {
        let Ok(event) = serde_json::from_str::<SessionEvent>(&record.payload_json) else {
            continue;
        };
        if let SessionEvent::ItemCompleted(item_event) = event {
            match item_event.item.kind {
                TranscriptItemKind::AssistantMessage => {
                    append_content_text(&mut assistant, &item_event.item.content_parts);
                }
                TranscriptItemKind::ToolInvocation => {
                    if matches!(item_event.item.status, TranscriptItemStatus::Failed) {
                        let label = item_event
                            .item
                            .title
                            .or(item_event.item.native_tool_name)
                            .unwrap_or_else(|| "tool invocation failed".to_string());
                        tool_errors.push(label);
                    }
                }
                _ => {}
            }
        }
    }
    let assistant_text = if assistant.trim().is_empty() {
        None
    } else {
        Some(trim_chars(assistant.trim(), ASSISTANT_TEXT_MAX_CHARS))
    };
    (assistant_text, tool_errors)
}

fn transcript_search_text(record: &crate::sessions::model::SessionEventRecord) -> String {
    let Ok(event) = serde_json::from_str::<SessionEvent>(&record.payload_json) else {
        return String::new();
    };
    match event {
        SessionEvent::ItemCompleted(item_event) => {
            let mut text = String::new();
            if let Some(title) = item_event.item.title {
                text.push_str(&title);
                text.push('\n');
            }
            if let Some(tool) = item_event.item.native_tool_name {
                text.push_str(&tool);
                text.push('\n');
            }
            append_content_text(&mut text, &item_event.item.content_parts);
            text
        }
        SessionEvent::ItemStarted(item_event) => {
            let mut text = String::new();
            if let Some(title) = item_event.item.title {
                text.push_str(&title);
                text.push('\n');
            }
            if let Some(tool) = item_event.item.native_tool_name {
                text.push_str(&tool);
                text.push('\n');
            }
            append_content_text(&mut text, &item_event.item.content_parts);
            text
        }
        SessionEvent::Error(error) => format!("{:?}", error.details),
        _ => String::new(),
    }
}

fn append_content_text(target: &mut String, parts: &[ContentPart]) {
    for part in parts {
        if let ContentPart::Text { text } = part {
            if !target.is_empty() {
                target.push('\n');
            }
            target.push_str(text);
        }
    }
}

fn make_snippet(text: &str, index: usize, needle_len: usize) -> String {
    let start = text[..index]
        .char_indices()
        .rev()
        .nth(SEARCH_SNIPPET_CONTEXT_CHARS)
        .map(|(idx, _)| idx)
        .unwrap_or(0);
    let raw_end = index.saturating_add(needle_len);
    let end = text[raw_end.min(text.len())..]
        .char_indices()
        .nth(SEARCH_SNIPPET_CONTEXT_CHARS)
        .map(|(idx, _)| raw_end.min(text.len()) + idx)
        .unwrap_or(text.len());
    let mut snippet = text[start..end].replace('\n', " ");
    if start > 0 {
        snippet.insert_str(0, "...");
    }
    if end < text.len() {
        snippet.push_str("...");
    }
    snippet
}

fn trim_chars(text: &str, max_chars: usize) -> String {
    let mut iter = text.chars();
    let trimmed = iter.by_ref().take(max_chars).collect::<String>();
    if iter.next().is_some() {
        format!("{trimmed}...")
    } else {
        trimmed
    }
}

fn map_access_error(error: WorkspaceAccessError) -> SubagentError {
    SubagentError::MutationBlocked(error.to_string())
}
