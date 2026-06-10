use serde::Deserialize;
use serde_json::{json, Value};

use crate::integrations::mcp::tools::tool_definition;

pub const MUTATING_TOOL_NAMES: &[&str] = &[
    "create_artifact",
    "update_artifact",
    "delete_artifact",
    "create_coding_workspace",
    "create_cowork_workspace",
    "create_coding_session",
    "create_cowork_agent",
    "send_coding_message",
    "send_cowork_agent_message",
    "schedule_coding_wake",
    "schedule_cowork_agent_wake",
    "close_cowork_agent",
];

#[cfg(test)]
pub(super) const READ_ONLY_TOOL_NAMES: &[&str] = &[
    "list_artifacts",
    "get_artifact",
    "get_coding_workspace_launch_options",
    "get_cowork_workspace_launch_options",
    "list_coding_workspaces",
    "list_cowork_workspaces",
    "get_coding_session_launch_options",
    "get_cowork_agent_launch_options",
    "get_coding_status",
    "get_cowork_agent_status",
    "read_coding_events",
    "read_cowork_agent_events",
    "read_cowork_agent_latest_turns",
    "search_cowork_agent_transcript",
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
    #[serde(default)]
    pub cowork_workspace_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CreateCodingSessionArgs {
    #[serde(default)]
    pub cowork_workspace_id: Option<String>,
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
pub(super) struct CodingSessionArgs {
    #[serde(default)]
    pub cowork_agent_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SendCodingMessageArgs {
    #[serde(default)]
    pub cowork_agent_id: Option<String>,
    pub prompt: String,
    #[serde(default)]
    pub wake_on_completion: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ReadCodingEventsArgs {
    #[serde(default)]
    pub cowork_agent_id: Option<String>,
    #[serde(default)]
    pub since_seq: Option<i64>,
    #[serde(default)]
    pub limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ReadCodingLatestTurnsArgs {
    #[serde(default)]
    pub cowork_agent_id: Option<String>,
    #[serde(default)]
    pub limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SearchCodingTranscriptArgs {
    #[serde(default)]
    pub cowork_agent_id: Option<String>,
    pub query: String,
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
        "get_cowork_workspace_launch_options"
            | "get_coding_workspace_launch_options"
            | "create_cowork_workspace"
            | "create_coding_workspace"
            | "list_cowork_workspaces"
            | "list_coding_workspaces"
            | "get_cowork_agent_launch_options"
            | "get_coding_session_launch_options"
            | "create_cowork_agent"
            | "create_coding_session"
            | "send_cowork_agent_message"
            | "send_coding_message"
            | "schedule_cowork_agent_wake"
            | "schedule_coding_wake"
            | "get_cowork_agent_status"
            | "get_coding_status"
            | "read_cowork_agent_events"
            | "read_coding_events"
            | "read_cowork_agent_latest_turns"
            | "search_cowork_agent_transcript"
            | "close_cowork_agent"
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
            "get_cowork_workspace_launch_options",
            "List source workspace options before creating cowork-managed workspaces.",
            json!({ "type": "object", "properties": {} }),
        ),
        tool_definition(
            "create_cowork_workspace",
            "Create a cowork-managed standard worktree workspace. This only provisions the workspace; call create_cowork_agent to start agent work inside it.",
            json!({
                "type": "object",
                "properties": {
                    "sourceWorkspaceId": { "type": "string" },
                    "label": { "type": "string" },
                    "workspaceName": { "type": "string" },
                    "branchName": { "type": "string" }
                },
                "required": ["sourceWorkspaceId"]
            }),
        ),
        tool_definition(
            "list_cowork_workspaces",
            "List cowork-managed workspaces and linked cowork agents owned by this cowork thread.",
            json!({ "type": "object", "properties": {} }),
        ),
        tool_definition(
            "get_cowork_agent_launch_options",
            "List supported agent/model choices and recommended mode ids before creating a cowork agent inside an owned cowork workspace.",
            json!({
                "type": "object",
                "properties": {
                    "coworkWorkspaceId": { "type": "string", "description": "Stable cowork workspace target id." }
                }
            }),
        ),
        tool_definition(
            "create_cowork_agent",
            "Create a linked cowork agent inside an owned cowork-managed workspace and send it an initial prompt.",
            json!({
                "type": "object",
                "properties": {
                    "coworkWorkspaceId": { "type": "string", "description": "Stable cowork workspace target id." },
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
        tool_definition(
            "send_cowork_agent_message",
            "Send or queue a parent-authored prompt to an owned cowork agent.",
            json!({
                "type": "object",
                "properties": {
                    "coworkAgentId": { "type": "string", "description": "Stable cowork agent target id." },
                    "prompt": { "type": "string" },
                    "wakeOnCompletion": { "type": "boolean" }
                },
                "required": ["prompt"]
            }),
        ),
        tool_definition(
            "schedule_cowork_agent_wake",
            "Schedule a one-shot wake for the next newly completed turn of an owned cowork agent.",
            json!({
                "type": "object",
                "properties": {
                    "coworkAgentId": { "type": "string", "description": "Stable cowork agent target id." }
                }
            }),
        ),
        tool_definition(
            "get_cowork_agent_status",
            "Get execution status for an owned cowork agent.",
            json!({
                "type": "object",
                "properties": {
                    "coworkAgentId": { "type": "string", "description": "Stable cowork agent target id." }
                }
            }),
        ),
        tool_definition(
            "read_cowork_agent_events",
            "Read a bounded, sanitized event slice from an owned cowork agent.",
            json!({
                "type": "object",
                "properties": {
                    "coworkAgentId": { "type": "string", "description": "Stable cowork agent target id." },
                    "sinceSeq": { "type": "integer" },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 100 }
                }
            }),
        ),
        tool_definition(
            "read_cowork_agent_latest_turns",
            "Read concise summaries for the latest completed turns from an owned cowork agent.",
            json!({
                "type": "object",
                "properties": {
                    "coworkAgentId": { "type": "string", "description": "Stable cowork agent target id." },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 10 }
                }
            }),
        ),
        tool_definition(
            "search_cowork_agent_transcript",
            "Search bounded transcript text for an owned cowork agent.",
            json!({
                "type": "object",
                "properties": {
                    "coworkAgentId": { "type": "string", "description": "Stable cowork agent target id." },
                    "query": { "type": "string" },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 25 }
                },
                "required": ["query"]
            }),
        ),
        tool_definition(
            "close_cowork_agent",
            "Close an owned cowork agent and stop future prompts/wakes while preserving history.",
            json!({
                "type": "object",
                "properties": {
                    "coworkAgentId": { "type": "string", "description": "Stable cowork agent target id." }
                }
            }),
        ),
        tool_definition(
            "get_coding_workspace_launch_options",
            "Deprecated alias for get_cowork_workspace_launch_options.",
            json!({ "type": "object", "properties": {} }),
        ),
        tool_definition(
            "create_coding_workspace",
            "Deprecated alias for create_cowork_workspace.",
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
            "Deprecated alias for list_cowork_workspaces.",
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
