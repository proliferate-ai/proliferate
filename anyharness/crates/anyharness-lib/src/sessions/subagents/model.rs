pub use crate::sessions::links::completions::{
    LinkCompletionRecord as SubagentCompletionRecord,
    LinkWakeScheduleRecord as SubagentWakeScheduleRecord,
};

#[derive(Debug, Clone)]
pub struct SubagentSummary {
    pub link_id: String,
    pub child_session_id: String,
    pub label: Option<String>,
    pub status: String,
    pub agent_kind: String,
    pub model_id: Option<String>,
    pub mode_id: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct SubagentEventSlice {
    pub child_session_id: String,
    pub events: Vec<serde_json::Value>,
    pub next_since_seq: Option<i64>,
    pub truncated: bool,
}
