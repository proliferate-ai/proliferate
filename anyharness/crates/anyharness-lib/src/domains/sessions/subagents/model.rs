pub use crate::domains::sessions::links::completions::{
    LinkCompletionRecord as SubagentCompletionRecord,
    LinkWakeScheduleRecord as SubagentWakeScheduleRecord,
};

use crate::domains::sessions::extensions::SessionTurnOutcome;

#[derive(Debug, Clone)]
pub struct SubagentSummary {
    pub subagent_id: Option<String>,
    pub link_id: String,
    pub child_session_id: String,
    pub label: Option<String>,
    pub status: String,
    pub agent_kind: String,
    pub model_id: Option<String>,
    pub mode_id: Option<String>,
    pub created_at: String,
    pub closed_at: Option<String>,
}

#[derive(Debug, Clone)]
pub struct SessionSubagentsContext {
    pub parent: Option<ParentSubagentLinkContext>,
    pub children: Vec<ChildSubagentContext>,
}

#[derive(Debug, Clone)]
pub struct ParentSubagentLinkContext {
    pub subagent_id: Option<String>,
    pub session_link_id: String,
    pub parent_session_id: String,
    pub parent_title: Option<String>,
    pub parent_agent_kind: String,
    pub parent_model_id: Option<String>,
    pub label: Option<String>,
    pub link_created_at: String,
    pub link_closed_at: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ChildSubagentContext {
    pub subagent_id: Option<String>,
    pub session_link_id: String,
    pub child_session_id: String,
    pub title: Option<String>,
    pub label: Option<String>,
    pub status: String,
    pub agent_kind: String,
    pub model_id: Option<String>,
    pub mode_id: Option<String>,
    pub link_created_at: String,
    pub link_closed_at: Option<String>,
    pub child_created_at: String,
    pub latest_completion: Option<SubagentCompletionSummary>,
    pub wake_scheduled: bool,
}

#[derive(Debug, Clone)]
pub struct SubagentCompletionSummary {
    pub completion_id: String,
    pub child_turn_id: String,
    pub outcome: SessionTurnOutcome,
    pub child_last_event_seq: i64,
    pub created_at: String,
    pub parent_event_seq: Option<i64>,
    pub parent_prompt_seq: Option<i64>,
}

pub fn normalized_session_status(status: &str) -> &'static str {
    match status {
        "starting" => "starting",
        "idle" => "idle",
        "running" => "running",
        "completed" => "completed",
        "closed" => "closed",
        "errored" => "errored",
        _ => "errored",
    }
}

#[derive(Debug, Clone)]
pub struct SubagentEventSlice {
    pub child_session_id: String,
    pub events: Vec<serde_json::Value>,
    pub next_since_seq: Option<i64>,
    pub truncated: bool,
}

#[derive(Debug, Clone)]
pub struct SubagentLatestTurn {
    pub child_turn_id: String,
    pub outcome: String,
    pub created_at: String,
    pub child_last_event_seq: i64,
    pub assistant_text: Option<String>,
    pub tool_errors: Vec<String>,
    pub event_count: usize,
}

#[derive(Debug, Clone)]
pub struct SubagentTranscriptSearchMatch {
    pub seq: i64,
    pub timestamp: String,
    pub turn_id: Option<String>,
    pub item_id: Option<String>,
    pub snippet: String,
}
