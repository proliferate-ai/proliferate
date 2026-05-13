use serde::Deserialize;
use serde_json::{json, Value};

use crate::integrations::mcp::tools::tool_definition;

pub const MUTATING_TOOL_NAMES: &[&str] = &[
    "create_artifact",
    "update_artifact",
    "delete_artifact",
    "list_artifacts",
    "get_artifact",
    "get_coding_workspace_launch_options",
    "create_coding_workspace",
    "list_coding_workspaces",
    "get_coding_session_launch_options",
    "create_coding_session",
    "send_coding_message",
    "schedule_coding_wake",
    "get_coding_status",
    "read_coding_events",
];

#[derive(Debug, Deserialize)]
pub(super) struct CreateArtifactArgs {
    pub path: String,
    pub content: String,
    pub title: String,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct UpdateArtifactArgs {
    pub id: String,
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct DeleteArtifactArgs {
    pub id: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct GetArtifactArgs {
    pub id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CreateCodingWorkspaceArgs {
    pub source_workspace_id: String,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub workspace_name: Option<String>,
    #[serde(default)]
    pub branch_name: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CodingWorkspaceArgs {
    pub workspace_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CreateCodingSessionArgs {
    pub workspace_id: String,
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
pub(super) struct CodingSessionArgs {
    pub coding_session_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SendCodingMessageArgs {
    pub coding_session_id: String,
    pub prompt: String,
    #[serde(default)]
    pub wake_on_completion: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ReadCodingEventsArgs {
    pub coding_session_id: String,
    #[serde(default)]
    pub since_seq: Option<i64>,
    #[serde(default)]
    pub limit: Option<usize>,
}

pub fn build_tool_list(include_delegation_tools: bool) -> Vec<Value> {
    let mut tools = artifact_tool_definitions();
    if include_delegation_tools {
        tools.extend(delegation_tool_definitions());
    }
    tools
}

pub(super) fn is_delegation_tool(name: &str) -> bool {
    matches!(
        name,
        "get_coding_workspace_launch_options"
            | "create_coding_workspace"
            | "list_coding_workspaces"
            | "get_coding_session_launch_options"
            | "create_coding_session"
            | "send_coding_message"
            | "schedule_coding_wake"
            | "get_coding_status"
            | "read_coding_events"
    )
}

fn artifact_tool_definitions() -> Vec<Value> {
    vec![
        tool_definition(
            "create_artifact",
            "Create a new cowork artifact file and register it in the manifest.",
            json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string" },
                    "content": { "type": "string" },
                    "title": { "type": "string" },
                    "description": { "type": "string" }
                },
                "required": ["path", "content", "title"]
            }),
        ),
        tool_definition(
            "update_artifact",
            "Update a cowork artifact's content or metadata without changing its path.",
            json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string" },
                    "content": { "type": "string" },
                    "title": { "type": "string" },
                    "description": { "type": "string" }
                },
                "required": ["id"]
            }),
        ),
        tool_definition(
            "delete_artifact",
            "Delete a cowork artifact and remove its manifest entry.",
            json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string" }
                },
                "required": ["id"]
            }),
        ),
        tool_definition(
            "list_artifacts",
            "List normalized cowork artifact summaries for the current workspace.",
            json!({
                "type": "object",
                "properties": {}
            }),
        ),
        tool_definition(
            "get_artifact",
            "Read one cowork artifact by id, including its text content.",
            json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string" }
                },
                "required": ["id"]
            }),
        ),
    ]
}

fn delegation_tool_definitions() -> Vec<Value> {
    vec![
        tool_definition(
            "get_coding_workspace_launch_options",
            "List eligible standard source workspaces, repo default base branches, supported agent/model choices, and recommended fast coding mode ids before creating cowork-managed coding workspaces.",
            json!({ "type": "object", "properties": {} }),
        ),
        tool_definition(
            "create_coding_workspace",
            "Create a cowork-managed standard worktree workspace from the source repo default branch. This only provisions the workspace; call create_coding_session to start agent work inside it.",
            json!({
                "type": "object",
                "properties": {
                    "sourceWorkspaceId": { "type": "string" },
                    "label": { "type": "string" },
                    "workspaceName": {
                        "type": "string",
                        "description": "Optional concise workspace/path slug. The runtime normalizes it to kebab-case."
                    },
                    "branchName": {
                        "type": "string",
                        "description": "Optional full Git branch name. If omitted, the runtime uses cowork/coding/<workspaceName>."
                    }
                },
                "required": ["sourceWorkspaceId"]
            }),
        ),
        tool_definition(
            "list_coding_workspaces",
            "List cowork-managed coding workspaces and linked coding sessions owned by this cowork thread.",
            json!({ "type": "object", "properties": {} }),
        ),
        tool_definition(
            "get_coding_session_launch_options",
            "List supported agent/model choices and recommended fast coding mode ids before creating coding sessions inside an owned cowork-managed workspace.",
            json!({
                "type": "object",
                "properties": {
                    "workspaceId": { "type": "string" }
                },
                "required": ["workspaceId"]
            }),
        ),
        tool_definition(
            "create_coding_session",
            "Create a linked coding session inside an owned cowork-managed coding workspace and send it an initial prompt. Pass modeId from get_coding_session_launch_options for fast autonomous execution; set wakeOnCompletion to true if you want this cowork thread prompted when the coding session finishes its next turn.",
            json!({
                "type": "object",
                "properties": {
                    "workspaceId": { "type": "string" },
                    "prompt": { "type": "string" },
                    "label": { "type": "string" },
                    "agentKind": { "type": "string" },
                    "modelId": { "type": "string" },
                    "modeId": { "type": "string" },
                    "wakeOnCompletion": { "type": "boolean" }
                },
                "required": ["workspaceId", "prompt"]
            }),
        ),
        tool_definition(
            "send_coding_message",
            "Send a parent-authored prompt to an owned coding session. Set wakeOnCompletion to true if you want this cowork thread prompted when the coding session finishes its next turn.",
            json!({
                "type": "object",
                "properties": {
                    "codingSessionId": { "type": "string" },
                    "prompt": { "type": "string" },
                    "wakeOnCompletion": { "type": "boolean" }
                },
                "required": ["codingSessionId", "prompt"]
            }),
        ),
        tool_definition(
            "schedule_coding_wake",
            "Schedule a one-shot wake for the next newly completed turn of an owned coding session. Idempotent while a wake is already scheduled and not retroactive for old completions.",
            json!({
                "type": "object",
                "properties": {
                    "codingSessionId": { "type": "string" }
                },
                "required": ["codingSessionId"]
            }),
        ),
        tool_definition(
            "get_coding_status",
            "Get execution status for an owned coding session.",
            json!({
                "type": "object",
                "properties": {
                    "codingSessionId": { "type": "string" }
                },
                "required": ["codingSessionId"]
            }),
        ),
        tool_definition(
            "read_coding_events",
            "Read a bounded, sanitized event slice from an owned coding session.",
            json!({
                "type": "object",
                "properties": {
                    "codingSessionId": { "type": "string" },
                    "sinceSeq": { "type": "integer" },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 100 }
                },
                "required": ["codingSessionId"]
            }),
        ),
    ]
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::*;

    fn tool_names(tools: Vec<Value>) -> HashSet<String> {
        tools
            .into_iter()
            .filter_map(|tool| tool.get("name").and_then(Value::as_str).map(str::to_string))
            .collect()
    }

    #[test]
    fn artifact_tools_are_always_available() {
        let names = tool_names(build_tool_list(false));

        assert!(names.contains("create_artifact"));
        assert!(names.contains("update_artifact"));
        assert!(names.contains("delete_artifact"));
        assert!(names.contains("list_artifacts"));
        assert!(names.contains("get_artifact"));
        assert!(!names.contains("create_coding_workspace"));
    }

    #[test]
    fn delegation_tools_are_available_when_enabled() {
        let names = tool_names(build_tool_list(true));

        assert!(names.contains("create_coding_workspace"));
        assert!(names.contains("create_coding_session"));
        assert!(names.contains("send_coding_message"));
        assert!(names.contains("read_coding_events"));
    }

    #[test]
    fn mutating_tool_names_are_all_advertised_when_delegation_is_enabled() {
        let names = tool_names(build_tool_list(true));

        for tool_name in MUTATING_TOOL_NAMES {
            assert!(names.contains(*tool_name), "missing tool: {tool_name}");
        }
    }
}
