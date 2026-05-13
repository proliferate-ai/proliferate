use serde_json::{json, Value};

use crate::integrations::mcp::tools::tool_definition;

pub fn build_tool_list() -> Vec<Value> {
    vec![
        tool_definition(
            "list_available_skills",
            "List the plugin-provided skills enabled for this session.",
            json!({
                "type": "object",
                "properties": {}
            }),
        ),
        tool_definition(
            "activate_skill",
            "Load the full markdown instructions for one enabled skill before using it.",
            json!({
                "type": "object",
                "properties": {
                    "skillId": { "type": "string" }
                },
                "required": ["skillId"]
            }),
        ),
        tool_definition(
            "get_skill_resource",
            "Load one inline resource attached to an activated skill.",
            json!({
                "type": "object",
                "properties": {
                    "skillId": { "type": "string" },
                    "resourceId": { "type": "string" }
                },
                "required": ["skillId", "resourceId"]
            }),
        ),
    ]
}
