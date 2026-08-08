use serde::Deserialize;
use serde_json::{json, Value};

use super::context::AgentOpsMcpContext;
use crate::domains::sessions::delegation::READ_EVENTS_MAX_LIMIT;
use crate::integrations::mcp::tools::tool_definition;

/// Pre-agent-ops tool names, mapped to what they dispatch to now. Sessions bake
/// their tool list in at launch, so a renamed tool has to stay callable under
/// the old name; `tools/list` only ever advertises the canonical set.
pub const DEPRECATED_TOOL_ALIASES: &[(&str, &str)] = &[
    ("create_subagent", "spawn_subagent"),
    ("close_subagent", "close_agent"),
];

// Aliases are listed too: this is matched on the wire name to decide whether a
// call takes the workspace write lease.
pub const MUTATING_TOOL_NAMES: &[&str] = &[
    "spawn_subagent",
    "create_subagent",
    "send_subagent_message",
    "schedule_subagent_wake",
    "close_agent",
    "close_subagent",
];

/// Resolves a wire tool name to the implementation it dispatches to.
pub fn canonical_tool_name(name: &str) -> &str {
    DEPRECATED_TOOL_ALIASES
        .iter()
        .find(|(alias, _)| *alias == name)
        .map_or(name, |(_, canonical)| *canonical)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSubagentArgs {
    pub prompt: String,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub harness_id: Option<String>,
    #[serde(default)]
    pub initial_config: Option<Value>,
    #[serde(default)]
    pub wake_on_completion: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChildSessionArgs {
    #[serde(default)]
    pub subagent_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendSubagentMessageArgs {
    #[serde(default)]
    pub subagent_id: Option<String>,
    pub prompt: String,
    #[serde(default)]
    pub wake_on_completion: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadSubagentEventsArgs {
    #[serde(default)]
    pub subagent_id: Option<String>,
    #[serde(default)]
    pub since_seq: Option<i64>,
    #[serde(default)]
    pub limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadSubagentLatestTurnsArgs {
    #[serde(default)]
    pub subagent_id: Option<String>,
    #[serde(default)]
    pub limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchSubagentTranscriptArgs {
    #[serde(default)]
    pub subagent_id: Option<String>,
    pub query: String,
    #[serde(default)]
    pub limit: Option<usize>,
}

pub fn build_tool_list(ctx: &AgentOpsMcpContext) -> Vec<Value> {
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
                "spawn_subagent",
                "Create a same-workspace child agent session and send it an initial prompt. Call get_subagent_launch_options first when choosing harnessId or initialConfig. wakeOnCompletion arms a one-shot next-completion wake before sending the prompt.",
                json!({
                    "type": "object",
                    "properties": {
                        "prompt": { "type": "string" },
                        "label": { "type": "string" },
                        "harnessId": { "type": "string" },
                        "initialConfig": {
                            "type": "object",
                            "additionalProperties": true,
                            "properties": {
                                "modelId": { "type": "string" },
                                "modeId": { "type": "string" }
                            }
                        },
                        "wakeOnCompletion": { "type": "boolean" }
                    },
                    "required": ["prompt"]
                }),
            ),
        );
    }

    if ctx.can_create || ctx.existing_subagent_count > 0 {
        tools.extend([
        tool_definition(
            "send_subagent_message",
            "Send another prompt to an owned subagent. Messages automatically run or queue. wakeOnCompletion arms a one-shot next-completion wake before the prompt is sent.",
            json!({
                "type": "object",
                "properties": {
                    "subagentId": { "type": "string", "description": "Stable subagent target id." },
                    "prompt": { "type": "string" },
                    "wakeOnCompletion": { "type": "boolean" }
                },
                "required": ["prompt"]
            }),
        ),
        tool_definition(
            "schedule_subagent_wake",
            "Schedule a one-shot wake for an owned child session. The next newly recorded completed turn for that child will prompt you; already completed turns are not retroactive.",
            json!({
                "type": "object",
                "properties": {
                    "subagentId": { "type": "string", "description": "Stable subagent target id." }
                }
            }),
        ),
        tool_definition(
            "get_subagent_status",
            "Get execution status for an owned child session.",
            json!({
                "type": "object",
                "properties": {
                    "subagentId": { "type": "string", "description": "Stable subagent target id." }
                }
            }),
        ),
        tool_definition(
            "read_subagent_latest_turns",
            "Read concise summaries for the latest completed turns from an owned subagent.",
            json!({
                "type": "object",
                "properties": {
                    "subagentId": { "type": "string", "description": "Stable subagent target id." },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 10 }
                }
            }),
        ),
        tool_definition(
            "search_subagent_transcript",
            "Search bounded sanitized transcript text for an owned subagent.",
            json!({
                "type": "object",
                "properties": {
                    "subagentId": { "type": "string", "description": "Stable subagent target id." },
                    "query": { "type": "string" },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 25 }
                },
                "required": ["query"]
            }),
        ),
        tool_definition(
            "read_subagent_events",
            "Read a bounded, sanitized event slice from an owned child session.",
            json!({
                "type": "object",
                "properties": {
                    "subagentId": { "type": "string", "description": "Stable subagent target id." },
                    "sinceSeq": { "type": "integer" },
                    "limit": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": READ_EVENTS_MAX_LIMIT
                    }
                }
            }),
        ),
        tool_definition(
            "close_agent",
            "Close an owned subagent and stop future prompts/wakes while preserving history.",
            json!({
                "type": "object",
                "properties": {
                    "subagentId": { "type": "string", "description": "Stable subagent target id." }
                }
            }),
        ),
        ]);
    }

    tools
}

#[cfg(test)]
mod tests {
    use super::{
        build_tool_list, canonical_tool_name, AgentOpsMcpContext, DEPRECATED_TOOL_ALIASES,
        MUTATING_TOOL_NAMES,
    };
    use serde_json::Value;

    fn context(can_create: bool, existing_subagent_count: usize) -> AgentOpsMcpContext {
        AgentOpsMcpContext {
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
    fn tool_list_exposes_launch_options_before_create() {
        let tools = build_tool_list(&context(true, 0));
        let names = tool_names(&tools);

        assert_eq!(names.first().copied(), Some("get_subagent_launch_options"));
        assert!(names.contains(&"spawn_subagent"));
    }

    #[test]
    fn tool_list_advertises_inline_wake_on_completion() {
        let tools = build_tool_list(&context(true, 1));
        let serialized = serde_json::to_string(&tools).expect("serialize tool list");

        assert!(serialized.contains("wakeOnCompletion"));
        assert!(serialized.contains("schedule_subagent_wake"));
    }

    #[test]
    fn tool_input_schemas_do_not_use_top_level_combinators() {
        let tools = build_tool_list(&context(true, 1));

        assert_no_top_level_schema_combinators(&tools);
    }

    #[test]
    fn tool_list_hides_create_when_parent_cannot_spawn() {
        let tools = build_tool_list(&context(false, 0));
        let names = tool_names(&tools);

        assert!(names.contains(&"get_subagent_launch_options"));
        assert!(names.contains(&"list_subagents"));
        assert!(!names.contains(&"spawn_subagent"));
    }

    #[test]
    fn tool_list_keeps_child_actions_available_for_fresh_eligible_parent() {
        let tools = build_tool_list(&context(true, 0));
        let names = tool_names(&tools);

        assert!(names.contains(&"send_subagent_message"));
        assert!(names.contains(&"schedule_subagent_wake"));
        assert!(names.contains(&"get_subagent_status"));
        assert!(names.contains(&"read_subagent_events"));
    }

    #[test]
    fn tool_list_hides_child_actions_when_blocked_parent_has_no_children() {
        let tools = build_tool_list(&context(false, 0));
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
            let canonical = canonical_tool_name(tool_name);
            assert!(
                names.contains(&canonical),
                "mutating tool {tool_name} is not in the available agent ops tool list"
            );
        }
    }

    #[test]
    fn deprecated_aliases_resolve_to_advertised_tools() {
        let tools = build_tool_list(&context(true, 1));
        let names = tool_names(&tools);

        assert_eq!(
            DEPRECATED_TOOL_ALIASES,
            &[
                ("create_subagent", "spawn_subagent"),
                ("close_subagent", "close_agent")
            ]
        );
        for (alias, canonical) in DEPRECATED_TOOL_ALIASES {
            assert_eq!(canonical_tool_name(alias), *canonical);
            assert!(
                names.contains(canonical),
                "alias {alias} resolves to {canonical}, which no longer exists"
            );
        }
    }

    #[test]
    fn deprecated_aliases_stay_out_of_the_advertised_tool_list() {
        let tools = build_tool_list(&context(true, 1));
        let names = tool_names(&tools);

        for (alias, _) in DEPRECATED_TOOL_ALIASES {
            assert!(!names.contains(alias), "alias {alias} is advertised");
        }
    }

    #[test]
    fn canonical_names_pass_through_unchanged() {
        assert_eq!(canonical_tool_name("spawn_subagent"), "spawn_subagent");
        assert_eq!(canonical_tool_name("close_agent"), "close_agent");
        assert_eq!(canonical_tool_name("unknown_tool"), "unknown_tool");
    }
}
