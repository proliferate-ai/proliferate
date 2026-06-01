use serde::Deserialize;
use serde_json::{json, Value};

use crate::integrations::mcp::tools::tool_definition;

#[derive(Debug, Deserialize)]
pub struct SetWorkspaceDisplayNameArgs {
    #[serde(rename = "displayName", alias = "display_name")]
    pub display_name: String,
}

pub fn build_tool_list() -> Vec<Value> {
    vec![tool_definition(
        "set_workspace_display_name",
        "Set a concise human-readable display name for this workspace. During the first turn, call this directly with arguments shaped as {\"displayName\":\"<concise title>\"} before any user-visible response, clarification, plan, or other tool call. If tools are namespaced, this is mcp__workspace_naming__set_workspace_display_name. This tool is already available in the active tool list; do not use ToolSearch or subagents for workspace naming, and do not use this to rename git branches.",
        json!({
            "type": "object",
            "properties": {
                "displayName": {
                    "type": "string",
                    "minLength": 1
                }
            },
            "required": ["displayName"]
        }),
    )]
}

#[cfg(test)]
mod tests {
    use super::build_tool_list;

    #[test]
    fn tool_description_names_the_agent_visible_qualified_tool() {
        let tools = build_tool_list();
        let description = tools[0]["description"].as_str().expect("tool description");

        assert_eq!(tools[0]["name"], "set_workspace_display_name");
        assert!(description.contains("mcp__workspace_naming__set_workspace_display_name"));
        assert!(description.contains(r#"{"displayName":"<concise title>"}"#));
        assert!(description.contains("do not use ToolSearch"));
        assert!(description.contains("subagents"));
    }

    #[test]
    fn display_name_args_accept_camel_case_and_snake_case() {
        let camel_case: super::SetWorkspaceDisplayNameArgs =
            serde_json::from_value(serde_json::json!({ "displayName": "Chat" }))
                .expect("camelCase args");
        let snake_case: super::SetWorkspaceDisplayNameArgs =
            serde_json::from_value(serde_json::json!({ "display_name": "Chat" }))
                .expect("snake_case args");

        assert_eq!(camel_case.display_name, "Chat");
        assert_eq!(snake_case.display_name, "Chat");
    }
}
