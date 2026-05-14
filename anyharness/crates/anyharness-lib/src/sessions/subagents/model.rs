pub use crate::sessions::links::completions::{
    LinkCompletionRecord as SubagentCompletionRecord,
    LinkWakeScheduleRecord as SubagentWakeScheduleRecord,
};

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
