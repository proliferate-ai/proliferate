use serde::Deserialize;
use serde_json::{json, Value};

use crate::integrations::mcp::tools::tool_definition;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SetWorkspaceDisplayNameArgs {
    pub display_name: String,
}

pub(super) fn build_tool_list() -> Vec<Value> {
    vec![tool_definition(
        "set_workspace_display_name",
        "Set a concise human-readable display name for this workspace. During the first turn, call this directly before any user-visible response, clarification, plan, or other tool call. If tools are namespaced, this is mcp__workspace_naming__set_workspace_display_name. This tool is already available in the active tool list; do not use ToolSearch or subagents for workspace naming, and do not use this to rename git branches.",
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
        assert!(description.contains("do not use ToolSearch"));
        assert!(description.contains("subagents"));
    }
}
