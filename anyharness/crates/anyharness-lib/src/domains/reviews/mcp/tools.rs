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
    #[serde(default)]
    pub review_id: Option<String>,
    #[serde(default)]
    pub review_run_id: Option<String>,
    #[serde(default)]
    pub revised_plan_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetReviewStatusArgs {
    #[serde(default)]
    pub review_id: Option<String>,
    #[serde(default)]
    pub review_run_id: Option<String>,
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
            "Signal that the reviewed plan or implementation has been revised and is ready for the next review round. reviewId is required unless using the deprecated reviewRunId alias.",
            json!({
                "type": "object",
                "properties": {
                    "reviewId": { "type": "string", "description": "Preferred stable review target. Provide either reviewId or deprecated reviewRunId." },
                    "reviewRunId": { "type": "string", "description": "Deprecated alias for reviewId." },
                    "revisedPlanId": { "type": "string" }
                }
            }),
        ));
    }
    tools.push(tool_definition(
        "get_review_status",
        "Get active review status for this parent session. Optionally filter by reviewId; reviewRunId is a deprecated alias.",
        json!({
            "type": "object",
            "properties": {
                "reviewId": { "type": "string" },
                "reviewRunId": { "type": "string", "description": "Deprecated alias for reviewId." }
            }
        }),
    ));
    tools
}

#[cfg(test)]
mod tests {
    use super::{parent_tool_list, reviewer_tool_list, MUTATING_TOOL_NAMES};
    use serde_json::Value;

    fn names(tools: &[serde_json::Value]) -> Vec<String> {
        tools
            .iter()
            .filter_map(|tool| tool.get("name").and_then(|value| value.as_str()))
            .map(str::to_string)
            .collect::<Vec<_>>()
    }

    fn assert_no_top_level_schema_combinators(tools: &[Value]) {
        for tool in tools {
            let name = tool
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("<unknown>");
            let schema = tool
                .get("inputSchema")
                .unwrap_or_else(|| panic!("tool {name} is missing inputSchema"));
            for keyword in ["oneOf", "anyOf", "allOf"] {
                assert!(
                    schema.get(keyword).is_none(),
                    "tool {name} inputSchema uses unsupported top-level {keyword}"
                );
            }
        }
    }

    #[test]
    fn reviewer_tools_only_expose_review_submission() {
        assert_eq!(
            names(&reviewer_tool_list()),
            vec!["submit_review_result".to_string()]
        );
    }

    #[test]
    fn parent_tools_only_expose_revision_signal_when_allowed() {
        let without_signal = names(&parent_tool_list(false));
        assert_eq!(without_signal, vec!["get_review_status".to_string()]);

        let with_signal = names(&parent_tool_list(true));
        assert!(with_signal.contains(&"mark_review_revision_ready".to_string()));
        assert!(with_signal.contains(&"get_review_status".to_string()));
    }

    #[test]
    fn tool_input_schemas_do_not_use_top_level_combinators() {
        let tools = parent_tool_list(true);

        assert_no_top_level_schema_combinators(&tools);
    }

    #[test]
    fn mutating_tool_names_are_advertised_by_some_review_role() {
        let mut advertised = names(&reviewer_tool_list());
        advertised.extend(names(&parent_tool_list(true)));

        for tool_name in MUTATING_TOOL_NAMES {
            assert!(
                advertised.iter().any(|advertised| advertised == tool_name),
                "mutating tool {tool_name} is not in any review tool list"
            );
        }
    }
}
