use serde::Deserialize;
use serde_json::{json, Value};

use crate::integrations::mcp::tools::tool_definition;

pub const MUTATING_TOOL_NAMES: &[&str] = &["submit_review_result", "mark_review_revision_ready"];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitReviewResultArgs {
    pub pass: bool,
    pub summary: String,
    pub critique_markdown: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkReviewRevisionReadyArgs {
    pub review_run_id: String,
    #[serde(default)]
    pub revised_plan_id: Option<String>,
}

pub fn reviewer_tool_list() -> Vec<Value> {
    vec![tool_definition(
        "submit_review_result",
        "Submit the final structured review verdict. This is the only way to complete your review assignment.",
        json!({
            "type": "object",
            "properties": {
                "pass": { "type": "boolean" },
                "summary": { "type": "string" },
                "critiqueMarkdown": { "type": "string" }
            },
            "required": ["pass", "summary", "critiqueMarkdown"]
        }),
    )]
}

pub fn parent_tool_list(can_signal_revision: bool) -> Vec<Value> {
    let mut tools = Vec::new();
    if can_signal_revision {
        tools.push(tool_definition(
            "mark_review_revision_ready",
            "Signal that the reviewed plan or implementation has been revised and is ready for the next review round. reviewRunId is required.",
            json!({
                "type": "object",
                "properties": {
                    "reviewRunId": { "type": "string" },
                    "revisedPlanId": { "type": "string" }
                },
                "required": ["reviewRunId"]
            }),
        ));
    }
    tools.push(tool_definition(
        "get_review_status",
        "Get active review status for this parent session.",
        json!({ "type": "object", "properties": {} }),
    ));
    tools
}
