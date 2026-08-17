use serde_json::{json, Value};

use crate::integrations::mcp::tools::tool_definition;

pub const TOOL_NAMES: [&str; 20] = [
    "whoami",
    "list_workspaces",
    "list_workspace_options",
    "list_agents",
    "get_agent",
    "list_subagents",
    "list_agent_launch_options",
    "list_agent_config_options",
    "get_task_output",
    "create_workspace",
    "pin_workspace",
    "unpin_workspace",
    "create_agent",
    "configure_agent",
    "resume_agent",
    "send_message",
    "interrupt_agent",
    "close_subagent",
    "open_subagent",
    "promote_subagent",
];

const AGENT_ID_DESCRIPTION: &str =
    "Agent session id, as returned by create_agent, list_agents, get_agent, and list_subagents.";

pub const MUTATING_TOOL_NAMES: &[&str] = &[
    "create_workspace",
    "pin_workspace",
    "unpin_workspace",
    "create_agent",
    "configure_agent",
    "resume_agent",
    "interrupt_agent",
    "close_subagent",
    "open_subagent",
    "promote_subagent",
];

pub fn build_tool_list() -> Vec<Value> {
    vec![
        tool_definition(
            "whoami",
            "Return the authenticated caller's runtime, workspace, role, parent, status, and effective capabilities.",
            empty_schema(),
        ),
        tool_definition(
            "list_workspaces",
            "List workspaces hosted by this runtime.",
            paginated_schema(),
        ),
        tool_definition(
            "list_workspace_options",
            "List current repository and workspace-creation choices for this runtime.",
            empty_schema(),
        ),
        tool_definition(
            "list_agents",
            "List ordinary agents in this runtime; subagents are excluded.",
            json!({
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "workspaceId": { "type": "string" },
                    "status": { "type": "string", "enum": ["running", "available", "closed"] },
                    "cursor": { "type": "string" },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 100 }
                }
            }),
        ),
        tool_definition(
            "get_agent",
            "Get one same-runtime ordinary agent or a subagent owned by the caller.",
            target_schema(),
        ),
        tool_definition(
            "list_subagents",
            "List the caller's current subagents, including Closed subagents.",
            empty_schema(),
        ),
        tool_definition(
            "list_agent_launch_options",
            "List effective launch choices for an agent in a workspace.",
            workspace_schema(),
        ),
        tool_definition(
            "list_agent_config_options",
            "List effective live configuration choices for an authorized agent.",
            target_schema(),
        ),
        tool_definition(
            "get_task_output",
            "Read a bounded recent visible-message view for an authorized agent. Prefer send_message for a concise update.",
            json!({
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "agentId": { "type": "string" },
                    "cursor": { "type": "string" },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 50, "default": 10 }
                },
                "required": ["agentId"]
            }),
        ),
        tool_definition(
            "create_workspace",
            "Create a workspace on this runtime from a currently listed option.",
            json!({
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "repositoryId": { "type": "string" },
                    "creationMode": { "type": "string", "enum": ["worktree", "local"] },
                    "branch": { "type": "string" },
                    "displayName": { "type": "string" }
                },
                "required": ["repositoryId", "creationMode"]
            }),
        ),
        tool_definition(
            "pin_workspace",
            "Request that the connected Proliferate client pin a workspace in its device-local sidebar preferences.",
            workspace_schema(),
        ),
        tool_definition(
            "unpin_workspace",
            "Request that the connected Proliferate client unpin a workspace from its device-local sidebar preferences.",
            workspace_schema(),
        ),
        tool_definition(
            "create_agent",
            "Create an ordinary agent or same-workspace subagent using current launch choices.",
            json!({
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "workspaceId": { "type": "string" },
                    "kind": { "type": "string", "enum": ["ordinary", "subagent"] },
                    "task": {
                        "type": "string",
                        "description": "Required for subagents; optional for ordinary agents."
                    },
                    "agentKind": { "type": "string" },
                    "modelId": { "type": "string" },
                    "modeId": { "type": "string" }
                },
                "required": ["workspaceId", "kind"],
                "if": {
                    "properties": { "kind": { "const": "subagent" } },
                    "required": ["kind"]
                },
                "then": { "required": ["task"] }
            }),
        ),
        tool_definition(
            "configure_agent",
            "Apply one currently listed live configuration choice to an authorized agent.",
            json!({
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "agentId": { "type": "string" },
                    "configId": { "type": "string" },
                    "value": { "type": "string" }
                },
                "required": ["agentId", "configId", "value"]
            }),
        ),
        tool_definition("resume_agent", "Resume an authorized cold agent.", target_schema()),
        tool_definition(
            "send_message",
            "Durably send an attributed message to an authorized agent.",
            json!({
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "agentId": { "type": "string", "description": AGENT_ID_DESCRIPTION },
                    "message": { "type": "string" }
                },
                "required": ["agentId", "message"]
            }),
        ),
        tool_definition("interrupt_agent", "Interrupt an authorized agent's active turn.", target_schema()),
        tool_definition("close_subagent", "Close an owned subagent while preserving its conversation.", target_schema()),
        tool_definition("open_subagent", "Open an owned Closed subagent on the same conversation.", target_schema()),
        tool_definition("promote_subagent", "Promote an owned Open subagent into an ordinary agent without changing its session.", target_schema()),
    ]
}

fn empty_schema() -> Value {
    json!({ "type": "object", "additionalProperties": false, "properties": {} })
}

fn paginated_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "cursor": { "type": "string" },
            "limit": { "type": "integer", "minimum": 1, "maximum": 100 }
        }
    })
}

fn target_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "agentId": { "type": "string", "description": AGENT_ID_DESCRIPTION }
        },
        "required": ["agentId"]
    })
}

fn workspace_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "properties": { "workspaceId": { "type": "string" } },
        "required": ["workspaceId"]
    })
}

#[cfg(test)]
mod tests {
    use sha2::{Digest, Sha256};

    use super::*;

    #[test]
    fn workspace_mcp_declares_the_exact_frozen_tool_set_for_every_role() {
        let tools = build_tool_list();
        let names = tools
            .iter()
            .map(|tool| tool["name"].as_str().expect("tool name"))
            .collect::<Vec<_>>();
        assert_eq!(names, TOOL_NAMES);
        assert_eq!(tools.len(), 20);
    }

    #[test]
    fn create_agent_requires_task_only_for_subagents() {
        let tools = build_tool_list();
        let schema = tools
            .iter()
            .find(|tool| tool["name"] == "create_agent")
            .map(|tool| &tool["inputSchema"])
            .expect("create_agent schema");

        assert_eq!(schema["required"], json!(["workspaceId", "kind"]));
        assert_eq!(
            schema["if"],
            json!({
                "properties": { "kind": { "const": "subagent" } },
                "required": ["kind"]
            })
        );
        assert_eq!(schema["then"], json!({ "required": ["task"] }));
    }

    #[test]
    fn create_workspace_creation_mode_schema_is_exact() {
        let tools = build_tool_list();
        let schema = tools
            .iter()
            .find(|tool| tool["name"] == "create_workspace")
            .map(|tool| &tool["inputSchema"])
            .expect("create_workspace schema");

        assert_eq!(
            schema["properties"]["creationMode"],
            json!({ "type": "string", "enum": ["worktree", "local"] })
        );
    }

    #[test]
    fn send_message_owns_its_target_gate_instead_of_the_caller_route_gate() {
        assert!(!MUTATING_TOOL_NAMES.contains(&"send_message"));
    }

    #[test]
    fn workspace_mcp_tool_schema_snapshots() {
        let tools = build_tool_list();
        let actual = tools
            .iter()
            .map(|tool| {
                let bytes = serde_jcs::to_vec(&tool["inputSchema"]).expect("canonical schema");
                (
                    tool["name"].as_str().unwrap(),
                    format!("{:x}", Sha256::digest(bytes)),
                )
            })
            .collect::<Vec<_>>();
        let expected = vec![
            (
                "whoami",
                "99334726611ccf58a148b0814696bfa6fe08c1b2d027e946beccf5a74331c9aa".to_string(),
            ),
            (
                "list_workspaces",
                "8594214a14bdfe6be83b5033daa8633803d9dabee600d4f5261d01279cccb563".to_string(),
            ),
            (
                "list_workspace_options",
                "99334726611ccf58a148b0814696bfa6fe08c1b2d027e946beccf5a74331c9aa".to_string(),
            ),
            (
                "list_agents",
                "8a7b6993f5bc22d4c75c36bd1c1888d46175c5d5e0c0164acfe98274e697f996".to_string(),
            ),
            (
                "get_agent",
                "040a2e9313d184c809e29c107eb68a6aa48c8aa0da351773516a4177772faa2e".to_string(),
            ),
            (
                "list_subagents",
                "99334726611ccf58a148b0814696bfa6fe08c1b2d027e946beccf5a74331c9aa".to_string(),
            ),
            (
                "list_agent_launch_options",
                "0d410ecafd8bb89b734fbe54575ce1321e07445554ed19942980c506ca093f31".to_string(),
            ),
            (
                "list_agent_config_options",
                "040a2e9313d184c809e29c107eb68a6aa48c8aa0da351773516a4177772faa2e".to_string(),
            ),
            (
                "get_task_output",
                "2080dee0c750ebc85af285847bf07607d3c66130dd941fc77b769d112aa70b85".to_string(),
            ),
            (
                "create_workspace",
                "b19bb55531b302386a061881ab9c7c2a3c77448e1af4900db63c936eca1eeb1d".to_string(),
            ),
            (
                "pin_workspace",
                "0d410ecafd8bb89b734fbe54575ce1321e07445554ed19942980c506ca093f31".to_string(),
            ),
            (
                "unpin_workspace",
                "0d410ecafd8bb89b734fbe54575ce1321e07445554ed19942980c506ca093f31".to_string(),
            ),
            (
                "create_agent",
                "9e1467ed625a438a3fa71a4bbd3cdf7bfb504cf35fd881eb5bd99c8e91137228".to_string(),
            ),
            (
                "configure_agent",
                "2669893bebf02d0ec1cddb5ec9b21302fe2fe1d7601496bb1e5692ef569595a1".to_string(),
            ),
            (
                "resume_agent",
                "040a2e9313d184c809e29c107eb68a6aa48c8aa0da351773516a4177772faa2e".to_string(),
            ),
            (
                "send_message",
                "7835e37361209bef75ced0c752dc265d34f98a6bc5af270434f80e0847f54f44".to_string(),
            ),
            (
                "interrupt_agent",
                "040a2e9313d184c809e29c107eb68a6aa48c8aa0da351773516a4177772faa2e".to_string(),
            ),
            (
                "close_subagent",
                "040a2e9313d184c809e29c107eb68a6aa48c8aa0da351773516a4177772faa2e".to_string(),
            ),
            (
                "open_subagent",
                "040a2e9313d184c809e29c107eb68a6aa48c8aa0da351773516a4177772faa2e".to_string(),
            ),
            (
                "promote_subagent",
                "040a2e9313d184c809e29c107eb68a6aa48c8aa0da351773516a4177772faa2e".to_string(),
            ),
        ];
        assert_eq!(actual, expected);
    }
}
