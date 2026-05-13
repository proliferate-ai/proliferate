use serde::Deserialize;
use serde_json::{json, Value};

use super::context::SubagentMcpContext;
use crate::integrations::mcp::tools::tool_definition;
use crate::sessions::delegation::READ_EVENTS_MAX_LIMIT;

pub const MUTATING_TOOL_NAMES: &[&str] = &[
    "create_subagent",
    "send_subagent_message",
    "schedule_subagent_wake",
];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSubagentArgs {
    pub prompt: String,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub agent_kind: Option<String>,
    #[serde(default)]
    pub model_id: Option<String>,
    #[serde(default)]
    pub mode_id: Option<String>,
    #[serde(default)]
    pub wake_on_completion: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChildSessionArgs {
    pub child_session_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendSubagentMessageArgs {
    pub child_session_id: String,
    pub prompt: String,
    #[serde(default)]
    pub wake_on_completion: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadSubagentEventsArgs {
    pub child_session_id: String,
    #[serde(default)]
    pub since_seq: Option<i64>,
    #[serde(default)]
    pub limit: Option<usize>,
}

pub fn build_tool_list(ctx: &SubagentMcpContext) -> Vec<Value> {
    let mut tools = vec![
        tool_definition(
            "get_subagent_launch_options",
            "Describe subagent creation defaults, limits, supported agent/model choices, and available parent mode hints.",
            json!({ "type": "object", "properties": {} }),
        ),
        tool_definition(
            "list_subagents",
            "List child sessions owned by this parent session.",
            json!({ "type": "object", "properties": {} }),
        ),
    ];

    if ctx.can_create {
        tools.push(
            tool_definition(
                "create_subagent",
                "Create a same-workspace child agent session and send it an initial prompt. Call get_subagent_launch_options first when choosing agentKind, modelId, or modeId. To be prompted after the child's next completed turn, call schedule_subagent_wake after creating the child.",
                json!({
                    "type": "object",
                    "properties": {
                        "prompt": { "type": "string" },
                        "label": { "type": "string" },
                        "agentKind": { "type": "string" },
                        "modelId": { "type": "string" },
                        "modeId": { "type": "string" }
                    },
                    "required": ["prompt"]
                }),
            ),
        );
    }

    if ctx.existing_subagent_count > 0 {
        tools.extend([
        tool_definition(
            "send_subagent_message",
            "Send another prompt to an owned child session. To be prompted after the child's next completed turn, call schedule_subagent_wake after sending the message.",
            json!({
                "type": "object",
                "properties": {
                    "childSessionId": { "type": "string" },
                    "prompt": { "type": "string" }
                },
                "required": ["childSessionId", "prompt"]
            }),
        ),
        tool_definition(
            "schedule_subagent_wake",
            "Schedule a one-shot wake for an owned child session. The next newly recorded completed turn for that child will prompt you; already completed turns are not retroactive.",
            json!({
                "type": "object",
                "properties": {
                    "childSessionId": { "type": "string" }
                },
                "required": ["childSessionId"]
            }),
        ),
        tool_definition(
            "get_subagent_status",
            "Get execution status for an owned child session.",
            json!({
                "type": "object",
                "properties": {
                    "childSessionId": { "type": "string" }
                },
                "required": ["childSessionId"]
            }),
        ),
        tool_definition(
            "read_subagent_events",
            "Read a bounded, sanitized event slice from an owned child session.",
            json!({
                "type": "object",
                "properties": {
                    "childSessionId": { "type": "string" },
                    "sinceSeq": { "type": "integer" },
                    "limit": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": READ_EVENTS_MAX_LIMIT
                    }
                },
                "required": ["childSessionId"]
            }),
        ),
        ]);
    }

    tools
}

#[cfg(test)]
mod tests {
    use super::{build_tool_list, SubagentMcpContext, MUTATING_TOOL_NAMES};

    fn context(can_create: bool, existing_subagent_count: usize) -> SubagentMcpContext {
        SubagentMcpContext {
            parent_session_id: "session-1".to_string(),
            workspace_id: "workspace-1".to_string(),
            can_create,
            create_block_reason: if can_create {
                None
            } else {
                Some("blocked".to_string())
            },
            existing_subagent_count,
            max_subagents_per_parent: 8,
        }
    }

    fn tool_names(tools: &[serde_json::Value]) -> Vec<&str> {
        tools
            .iter()
            .filter_map(|tool| tool.get("name").and_then(|value| value.as_str()))
            .collect::<Vec<_>>()
    }

    #[test]
    fn tool_list_exposes_launch_options_before_create() {
        let tools = build_tool_list(&context(true, 0));
        let names = tool_names(&tools);

        assert_eq!(names.first().copied(), Some("get_subagent_launch_options"));
        assert!(names.contains(&"create_subagent"));
    }

    #[test]
    fn tool_list_does_not_advertise_inline_wake_on_completion() {
        let tools = build_tool_list(&context(true, 1));
        let serialized = serde_json::to_string(&tools).expect("serialize tool list");

        assert!(!serialized.contains("wakeOnCompletion"));
        assert!(serialized.contains("schedule_subagent_wake"));
    }

    #[test]
    fn tool_list_hides_create_when_parent_cannot_spawn() {
        let tools = build_tool_list(&context(false, 0));
        let names = tool_names(&tools);

        assert!(names.contains(&"get_subagent_launch_options"));
        assert!(names.contains(&"list_subagents"));
        assert!(!names.contains(&"create_subagent"));
    }

    #[test]
    fn tool_list_hides_child_actions_until_children_exist() {
        let tools = build_tool_list(&context(true, 0));
        let names = tool_names(&tools);

        assert!(!names.contains(&"send_subagent_message"));
        assert!(!names.contains(&"schedule_subagent_wake"));
        assert!(!names.contains(&"get_subagent_status"));
        assert!(!names.contains(&"read_subagent_events"));
    }

    #[test]
    fn mutating_tool_names_are_advertised_when_available() {
        let tools = build_tool_list(&context(true, 1));
        let names = tool_names(&tools);

        for tool_name in MUTATING_TOOL_NAMES {
            assert!(
                names.contains(tool_name),
                "mutating tool {tool_name} is not in the available subagent tool list"
            );
        }
    }
}
