pub use crate::domains::sessions::links::completions::LinkCompletionRecord as SubagentCompletionRecord;

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
