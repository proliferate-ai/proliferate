use serde::Deserialize;
use serde_json::{json, Value};

use super::context::AgentOpsMcpContext;
use crate::domains::sessions::delegation::READ_EVENTS_MAX_LIMIT;
use crate::domains::sessions::store::SESSION_SEARCH_MAX_LIMIT;
use crate::integrations::mcp::tools::tool_definition;

/// Pre-agent-ops tool names, mapped to what they dispatch to now. Sessions bake
/// their tool list in at launch, so a renamed tool has to stay callable under
/// the old name; `tools/list` only ever advertises the canonical set.
pub const DEPRECATED_TOOL_ALIASES: &[(&str, &str)] = &[
    ("create_subagent", "spawn_subagent"),
    ("close_subagent", "close_agent"),
];

// Aliases are listed too: this is matched on the wire name to decide whether a
// call takes the ROUTE's workspace write lease — the lease on the workspace in
// the URL, which is always the caller's.
//
// `send_agent_message` and `configure_agent` are deliberately absent. They are
// the tools here whose target can live in another workspace, so the caller's
// lease is the wrong one and they take the TARGET workspace's lease themselves
// (`peer_ops::lease_target_workspace_for_peer_write`), together with the target
// session's mutation permit. That is also the only way to keep the canonical
// `permit -> workspace lease` order: a route lease taken before the permit is
// the reversed order `api/session_admission_tests.rs` proves deadlocks against
// retire/purge. Absent here means "leases itself", never "mutates nothing".
// `close_agent`/`close_subagent` joined that list when close was link-scoped and
// therefore always same-workspace. It is now `close_agent(sessionId)`, whose
// target can be any owned agent anywhere, so it leases itself for the same two
// reasons — and it must, because a close acts on the target session and so
// takes that session's mutation permit, which has to be OUTSIDE any workspace
// lease.
//
// `spawn_agent` is ALSO absent, since `spawn_workspace` gave it somewhere else
// to spawn into. It creates a session in the TARGET workspace — which is the
// workspace whose retire preflight has to see that work — so it takes that
// workspace's write lease itself, exactly like `send_agent_message`. It has no
// permit to order against (there is no target session until it makes one), so
// it holds one lease and nothing else.
//
// `spawn_workspace` is absent for a different reason again: the workspace it
// mutates does not exist yet, so there is nothing to lease at all. It gates on
// the repo root's ACCESS state instead — the same thing the human worktree
// route (`api/http/workspaces_worktrees.rs`) does, and for the same reason.
// `get_workspace_options` is read-only, like every other `get_*` here.
pub const MUTATING_TOOL_NAMES: &[&str] = &[
    "spawn_subagent",
    "create_subagent",
    "send_subagent_message",
    "schedule_subagent_wake",
    "schedule_agent_wake",
    "promote_subagent",
];

/// The tools that make a session an owner of new agents. Withheld entirely from
/// an unpromoted subagent (ADR §3.3) — not merely refused at the fanout cap,
/// which is what `can_create` covers. Listed by wire name, aliases included,
/// because `calls::call_tool` enforces this at DISPATCH: a session's tool list
/// is frozen at launch, so an agent promoted (or not) after launch is holding a
/// stale advertisement either way.
pub const SPAWN_STYLE_TOOL_NAMES: &[&str] = &[
    "get_subagent_launch_options",
    "spawn_subagent",
    "create_subagent",
    "spawn_agent",
    // Ruling 3 names workspaces explicitly: an unpromoted subagent "cannot call
    // ANY spawn-style tool (subagent, agent, workspace)". `get_workspace_options`
    // joins its `get_subagent_launch_options` sibling for the same reason — the
    // shape of a spawn it may not perform is not information it can act on.
    "get_workspace_options",
    "spawn_workspace",
];

pub fn is_spawn_style_tool(name: &str) -> bool {
    SPAWN_STYLE_TOOL_NAMES.contains(&name)
}

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

/// `spawn_agent`'s arguments. Deliberately the same shape as
/// `CreateSubagentArgs` — the launch vocabulary an agent already knows — plus
/// `workspaceId`, which ADR §3.4 names. It defaults to the caller's own
/// workspace and accepts any other: naming one is the second step of ADR §5's
/// flow 4, after `spawn_workspace` returned it.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnAgentArgs {
    pub prompt: String,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub harness_id: Option<String>,
    #[serde(default)]
    pub initial_config: Option<Value>,
    #[serde(default)]
    pub wake_on_completion: bool,
    #[serde(default)]
    pub workspace_id: Option<String>,
}

/// `spawn_workspace`'s arguments — the three ADR §3.4 allows, plus a label for
/// the provenance stamp. Everything else about workspace creation (base branch,
/// name-conflict policy, setup script, checkout mode, surface) is server-side
/// policy: §3.1's alternatives section rejects exposing the full creation
/// surface to agents.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnWorkspaceArgs {
    /// Defaults to the caller's own repo root — "the same git repo" of ADR §1
    /// requirement 7.
    #[serde(default)]
    pub repo_root_id: Option<String>,
    /// `worktree` (default) or `local`.
    #[serde(default)]
    pub mode: Option<String>,
    /// Required iff `mode` is `worktree`.
    #[serde(default)]
    pub branch_name: Option<String>,
    #[serde(default)]
    pub label: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChildSessionArgs {
    #[serde(default)]
    pub subagent_id: Option<String>,
}

/// Both spellings of "which of my children", because promotion is reachable
/// from the subagent vocabulary (`subagentId`, what every link-scoped tool
/// takes) and from the peer vocabulary (`sessionId`, what `list_agents`
/// returns). They resolve through the same owned-link lookup.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromoteSubagentArgs {
    #[serde(default)]
    pub subagent_id: Option<String>,
    #[serde(default)]
    pub session_id: Option<String>,
}

/// `sessionId` is the tool's own argument; `subagentId` is kept for callers
/// still holding the pre-agent-ops `close_subagent` tool list, whose schema had
/// only that field.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloseAgentArgs {
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub subagent_id: Option<String>,
    #[serde(default)]
    pub reason: Option<String>,
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
pub struct ListAgentsArgs {
    #[serde(default)]
    pub query: Option<String>,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub workspace_id: Option<String>,
    #[serde(default)]
    pub include_closed: bool,
    #[serde(default)]
    pub limit: Option<usize>,
    #[serde(default)]
    pub cursor: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendAgentMessageArgs {
    pub session_id: String,
    pub message: String,
    /// Arms a one-shot wake on the target in the same flow as the send, so a
    /// target that finishes its turn without answering still pokes the sender.
    #[serde(default)]
    pub wake_on_reply: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleAgentWakeArgs {
    pub session_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetAgentConfigOptionsArgs {
    pub session_id: String,
}

/// Deliberately the same two fields as `SetSessionConfigOptionRequest`, the
/// body the human client posts to `/v1/sessions/{id}/config-options`. Model,
/// mode and thinking/effort are all `configId` + `value` pairs there; giving
/// agents a second vocabulary for the same apply path would be a vocabulary to
/// keep in sync, not a simplification.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigureAgentArgs {
    pub session_id: String,
    pub config_id: String,
    pub value: String,
}

#[derive(Debug, Default, Deserialize, PartialEq, Eq, Clone, Copy)]
#[serde(rename_all = "snake_case")]
pub enum ReadAgentTranscriptMode {
    #[default]
    LatestTurns,
    Search,
    Events,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadAgentTranscriptArgs {
    pub session_id: String,
    #[serde(default)]
    pub mode: ReadAgentTranscriptMode,
    #[serde(default)]
    pub query: Option<String>,
    #[serde(default)]
    pub since_seq: Option<i64>,
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
    // Peer messaging and peer reads are unconditional: reach is runtime-wide,
    // and every agent has them — including an unpromoted subagent, which loses
    // only the spawn-style tools.
    let mut tools = Vec::new();

    // Spawn-style tools are withheld from an unpromoted subagent entirely: it
    // is subordinate, so the shape of its options is not information it can
    // act on. Promotion returns them. This is advertisement only — the gate
    // that matters runs in `calls::call_tool`, because tool lists are frozen at
    // session launch and promotion happens later.
    if !ctx.is_unpromoted_subagent {
        tools.push(tool_definition(
            "get_subagent_launch_options",
            "Describe subagent creation defaults, limits, supported agent/model choices, and available parent mode hints.",
            json!({ "type": "object", "properties": {} }),
        ));
        tools.push(tool_definition(
            "get_workspace_options",
            "Describe the workspaces you could spawn: every git repo configured on this machine (id, name, path, default and current branch) and, per repo, the two ways to open one — a new branch in its own checkout (worktree) or the existing checkout in place (local). Repos this machine does not actually have are listed as unavailable with the reason. Read this before spawn_workspace.",
            json!({ "type": "object", "properties": {} }),
        ));
    }

    tools.extend([
        tool_definition(
            "list_subagents",
            "List child sessions owned by this parent session.",
            json!({ "type": "object", "properties": {} }),
        ),
        tool_definition(
            "list_agents",
            "List or search agent sessions across every workspace. Search by title or subagent label, or pass sessionId to resolve one id to its title. Returns a page ordered most-recently-active first, plus a nextCursor when more remain.",
            json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Case-insensitive substring matched against session titles and subagent labels." },
                    "sessionId": { "type": "string", "description": "Exact session id lookup." },
                    "workspaceId": { "type": "string", "description": "Restrict to one workspace. Omit to search every workspace." },
                    "includeClosed": { "type": "boolean", "description": "Include closed agents. Their transcripts stay readable; they take no messages." },
                    "limit": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": SESSION_SEARCH_MAX_LIMIT
                    },
                    "cursor": { "type": "string", "description": "nextCursor from a previous call." }
                }
            }),
        ),
        tool_definition(
            "send_agent_message",
            "Send a message to any open agent session in any workspace. The target receives your message verbatim inside an envelope naming you and your session id, so it can reply with send_agent_message. A busy target queues the message and reads it on its next turn; an idle one starts up; a closed one is rejected.",
            json!({
                "type": "object",
                "properties": {
                    "sessionId": { "type": "string", "description": "Target agent's session id. Use list_agents to find it." },
                    "message": { "type": "string", "description": "Message body, delivered verbatim." },
                    "wakeOnReply": { "type": "boolean", "description": "Wake you when the target finishes its next turn. A real reply already wakes you with the full message and cancels this; the wake is the safety net for a target that answers nobody." }
                },
                "required": ["sessionId", "message"]
            }),
        ),
        tool_definition(
            "schedule_agent_wake",
            "Wake yourself with a pointer when another agent finishes its next turn. A turn already running is covered; an IDLE target finishes nothing until someone prompts it, so the result reports targetStatus and targetRunning — if it is idle and you need an answer, send_agent_message instead. The pointer carries the target's label, session id and outcome — never its output; read the result with read_agent_transcript. Prefer wakeOnReply on send_agent_message when you are waiting on an answer.",
            json!({
                "type": "object",
                "properties": {
                    "sessionId": { "type": "string", "description": "Agent to wait on. Any open session, in any workspace." }
                },
                "required": ["sessionId"]
            }),
        ),
        tool_definition(
            "get_agent_config_options",
            "Describe what another agent's configuration allows changing right now: model, mode, thinking/effort and any other control its harness exposes, each with the configId and values configure_agent accepts. Values are composed from the target's own workspace catalog and its live controls, so they are what THAT agent can run — not what you can. Closed agents have no configuration left and are rejected.",
            json!({
                "type": "object",
                "properties": {
                    "sessionId": { "type": "string", "description": "Agent to inspect. Any open session, in any workspace." }
                },
                "required": ["sessionId"]
            }),
        ),
        tool_definition(
            "configure_agent",
            "Change one configuration option on another open agent — model, mode, thinking/effort, or anything else get_agent_config_options lists. Call get_agent_config_options first: configId and value must come from that target's composed options. The change applies immediately when the agent is idle and is queued to its next idle moment when it is mid-turn; either way it persists, so a relaunch keeps it. You cannot configure yourself.",
            json!({
                "type": "object",
                "properties": {
                    "sessionId": { "type": "string", "description": "Target agent's session id." },
                    "configId": { "type": "string", "description": "Option identifier from get_agent_config_options (for example \"model\" or \"mode\")." },
                    "value": { "type": "string", "description": "One of that option's listed values." }
                },
                "required": ["sessionId", "configId", "value"]
            }),
        ),
        tool_definition(
            "read_agent_transcript",
            "Read a bounded slice of any agent session's transcript, including closed ones. mode=latest_turns summarizes recent turns, mode=search finds matching text, mode=events returns a sanitized event slice from sinceSeq.",
            json!({
                "type": "object",
                "properties": {
                    "sessionId": { "type": "string", "description": "Session to read." },
                    "mode": {
                        "type": "string",
                        "enum": ["latest_turns", "search", "events"],
                        "description": "Defaults to latest_turns."
                    },
                    "query": { "type": "string", "description": "Required when mode is search." },
                    "sinceSeq": { "type": "integer", "description": "Cursor for mode=events." },
                    "limit": { "type": "integer", "minimum": 1 }
                },
                "required": ["sessionId"]
            }),
        ),
    ]);

    // Advertised on `can_spawn_agent`, NOT `can_create`: the fanout cap bounds
    // subordinates, and an owned agent is not one (ruling 9). A parent sitting
    // at eight subagents can still spawn a peer.
    if ctx.can_spawn_agent && !ctx.is_unpromoted_subagent {
        tools.push(tool_definition(
            "spawn_agent",
            "Create a new top-level agent you own, in your workspace, and send it a first message. \
             It is a PEER, not a subagent: it is not capped, it does not close when you close, and \
             it can spawn agents of its own from the start. Talk to it afterwards with \
             send_agent_message and its sessionId, exactly like any other agent. Use \
             spawn_subagent instead when you want a subordinate helper that closes with you.",
            json!({
                "type": "object",
                "properties": {
                    "prompt": { "type": "string", "description": "First message, delivered inside an envelope naming you and your session id so the agent can reply." },
                    "label": { "type": "string", "description": "Short name for the agent, shown wherever it appears." },
                    "harnessId": { "type": "string", "description": "Defaults to your own harness. See get_subagent_launch_options for what this workspace can launch." },
                    // Open, and open for the same reason `spawn_subagent` is:
                    // one launch vocabulary across both spawns, so an agent
                    // that learned one does not meet a stricter second. Only
                    // `modelId` and `modeId` are read; `appliedInitialConfig`
                    // in the result is what the new agent actually launched
                    // with, so anything else passed is visibly absent there
                    // rather than silently honoured. Tightening it is a change
                    // to make on both tools at once or not at all.
                    "initialConfig": {
                        "type": "object",
                        "additionalProperties": true,
                        "properties": {
                            "modelId": { "type": "string", "description": "Defaults to your current model." },
                            "modeId": { "type": "string", "description": "Defaults to your current mode." }
                        }
                    },
                    "wakeOnCompletion": { "type": "boolean", "description": "Wake you when the new agent finishes its first turn. Its reply already wakes you with the full message; this is the safety net for one that answers nobody." },
                    "workspaceId": { "type": "string", "description": "Where to put the agent. Defaults to your own workspace; pass the workspaceId from spawn_workspace to put it somewhere new. The harness and model are checked against THAT workspace's catalog, not yours." }
                },
                "required": ["prompt"]
            }),
        ));
        tools.push(tool_definition(
            "spawn_workspace",
            "Create a new workspace on this machine and get back its workspaceId, so you can \
             spawn_agent into it. mode=worktree (the default) makes a new branch in its own \
             checkout and leaves every existing checkout alone; mode=local opens a repo's \
             existing checkout in place, sharing files and git state with whoever else is in it. \
             Call get_workspace_options first for the repos you can use. Base branch, name \
             collisions and the setup script are handled for you. Workspaces you spawn cannot be \
             removed by you or any other agent — only a person can retire one.",
            json!({
                "type": "object",
                "properties": {
                    "repoRootId": { "type": "string", "description": "Repo to open, from get_workspace_options. Defaults to the repo your own workspace is in." },
                    "mode": {
                        "type": "string",
                        "enum": ["worktree", "local"],
                        "description": "Defaults to worktree."
                    },
                    "branchName": { "type": "string", "description": "Branch to create. Required for mode=worktree, ignored for mode=local. A name already in use gets a numeric suffix rather than failing." },
                    "label": { "type": "string", "description": "Short note recorded with the workspace, shown to whoever looks at where it came from." }
                }
            }),
        ));
    }

    if ctx.can_create && !ctx.is_unpromoted_subagent {
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
            "promote_subagent",
            "Promote one of your subagents to a peer. It keeps its transcript, its label and you as its owner, and it gains the full tool surface — including spawning its own agents. What it loses is subordination: it no longer closes when you close, and it no longer counts against your subagent limit. Promotion cannot be undone.",
            json!({
                "type": "object",
                "properties": {
                    "subagentId": { "type": "string", "description": "Stable subagent target id." },
                    "sessionId": { "type": "string", "description": "The subagent's session id, if you have that instead." }
                }
            }),
        ),
        tool_definition(
            "close_agent",
            "Close an agent you own and stop future prompts and wakes; its transcript stays readable. Its own unpromoted subagents close with it; agents it promoted do not. Closing an agent that is mid-turn does not interrupt it — it finishes the step it is on and then stops.",
            json!({
                "type": "object",
                "properties": {
                    "sessionId": { "type": "string", "description": "Session id of the agent to close. Must be one you own." },
                    "subagentId": { "type": "string", "description": "Stable subagent target id, if you have that instead." },
                    "reason": { "type": "string", "description": "Short note recorded with the close, shown to whoever looks at the agent later." }
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
        build_tool_list, canonical_tool_name, is_spawn_style_tool, AgentOpsMcpContext,
        DEPRECATED_TOOL_ALIASES, MUTATING_TOOL_NAMES, SPAWN_STYLE_TOOL_NAMES,
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
            // Independent of `can_create` on purpose: the cases these tests
            // build `can_create = false` for are the fanout cap, which does not
            // bound owned agents (ruling 9).
            can_spawn_agent: true,
            spawn_agent_block_reason: None,
            existing_subagent_count,
            max_subagents_per_parent: 8,
            is_unpromoted_subagent: false,
        }
    }

    /// A live unpromoted subagent: subordinate, so `validate_parent_can_spawn`
    /// already refuses it with DepthLimit, and it has no children of its own.
    fn unpromoted_subagent_context() -> AgentOpsMcpContext {
        AgentOpsMcpContext {
            is_unpromoted_subagent: true,
            ..context(false, 0)
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
    fn peer_messaging_and_reads_are_offered_to_every_caller() {
        // An unpromoted subagent keeps messaging, listing and reading; it loses
        // only the spawn-style tools.
        for ctx in [context(true, 2), unpromoted_subagent_context()] {
            let tools = build_tool_list(&ctx);
            let names = tool_names(&tools);

            assert!(names.contains(&"list_agents"));
            assert!(names.contains(&"send_agent_message"));
            assert!(names.contains(&"read_agent_transcript"));
        }
    }

    #[test]
    fn send_agent_message_leases_in_the_call_not_at_the_route() {
        // Not a read tool: it takes the TARGET workspace's SubagentWrite lease
        // and the target session's mutation permit inside the call, in that
        // order. The route's lease is the caller's workspace and would have to
        // be taken before the permit, which is the reversed lock order.
        assert!(!MUTATING_TOOL_NAMES.contains(&"send_agent_message"));
        // The link-scoped sibling still leases at the route: its target is
        // always in the caller's workspace.
        assert!(MUTATING_TOOL_NAMES.contains(&"send_subagent_message"));
        // Arming a wake mutates the WATCHER (the caller), so the route-level
        // lease on the caller's workspace is the right one.
        assert!(MUTATING_TOOL_NAMES.contains(&"schedule_agent_wake"));
        assert!(!MUTATING_TOOL_NAMES.contains(&"list_agents"));
        assert!(!MUTATING_TOOL_NAMES.contains(&"read_agent_transcript"));
    }

    #[test]
    fn configure_agent_leases_in_the_call_and_reading_options_leases_nothing() {
        // Same shape as `send_agent_message`, for the same reason: the target
        // can be in another workspace, so the route's caller-workspace lease is
        // the wrong one AND would be taken before the permit.
        assert!(!MUTATING_TOOL_NAMES.contains(&"configure_agent"));
        // Read-only: composing a target's options touches nothing.
        assert!(!MUTATING_TOOL_NAMES.contains(&"get_agent_config_options"));
    }

    #[test]
    fn configure_tools_are_offered_to_every_caller() {
        // Ruling 3: an unpromoted subagent loses the spawn tools and keeps
        // messaging, reading, waking and configuring.
        for ctx in [context(true, 2), unpromoted_subagent_context()] {
            let tools = build_tool_list(&ctx);
            let names = tool_names(&tools);

            assert!(names.contains(&"get_agent_config_options"));
            assert!(names.contains(&"configure_agent"));
        }
    }

    #[test]
    fn configure_agent_takes_the_human_config_option_fields() {
        // configId/value are the SetSessionConfigOptionRequest fields. A
        // renamed pair here would be a second vocabulary over one apply path.
        let configure = build_tool_list(&context(true, 0))
            .into_iter()
            .find(|tool| tool.get("name").and_then(Value::as_str) == Some("configure_agent"))
            .expect("configure_agent is advertised");

        let required = configure
            .pointer("/inputSchema/required")
            .and_then(Value::as_array)
            .expect("required list");
        assert_eq!(required, &["sessionId", "configId", "value"]);
    }

    #[test]
    fn session_scoped_wakes_are_offered_to_every_caller() {
        // Same reasoning as peer messaging: an unpromoted subagent loses spawn
        // tools, not the ability to wait on a peer.
        for ctx in [context(true, 2), unpromoted_subagent_context()] {
            let tools = build_tool_list(&ctx);
            let names = tool_names(&tools);

            assert!(names.contains(&"schedule_agent_wake"));
        }
    }

    #[test]
    fn send_agent_message_advertises_wake_on_reply() {
        let send = build_tool_list(&context(true, 0))
            .into_iter()
            .find(|tool| tool.get("name").and_then(Value::as_str) == Some("send_agent_message"))
            .expect("send_agent_message is advertised");

        assert!(send
            .pointer("/inputSchema/properties/wakeOnReply")
            .is_some());
        // It is optional: a send with no flag is still a plain send.
        let required = send
            .pointer("/inputSchema/required")
            .and_then(Value::as_array)
            .expect("required list");
        assert!(!required.iter().any(|value| value == "wakeOnReply"));
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

    /// `endpoint_operation_kind` matches `MUTATING_TOOL_NAMES` against the raw
    /// wire name, not the canonicalized one, to decide whether a call takes
    /// the workspace write lease. So every alias whose canonical target is
    /// mutating must itself be listed — otherwise a call under the old name
    /// skips `WorkspaceOperationKind::SubagentWrite` and the
    /// `assert_workspace_mutable` check that only runs when a lease is taken.
    #[test]
    fn every_alias_of_a_mutating_tool_is_itself_mutating() {
        for (alias, canonical) in DEPRECATED_TOOL_ALIASES {
            assert_eq!(
                MUTATING_TOOL_NAMES.contains(canonical),
                MUTATING_TOOL_NAMES.contains(alias),
                "alias {alias} and canonical {canonical} disagree on mutating status"
            );
        }
    }

    // --- ownership, promotion and close (ADR §3.3, §3.4) -----------------

    #[test]
    fn an_unpromoted_subagent_is_offered_no_spawn_style_tool() {
        let tools = build_tool_list(&unpromoted_subagent_context());
        let names = tool_names(&tools);

        for spawn_tool in SPAWN_STYLE_TOOL_NAMES {
            assert!(
                !names.contains(spawn_tool),
                "{spawn_tool} is advertised to an unpromoted subagent"
            );
        }
    }

    #[test]
    fn launch_options_come_back_once_the_subagent_is_promoted() {
        // Same session, one column later: it is still somebody's child, but it
        // is no longer subordinate, so the spawn surface returns.
        let promoted = AgentOpsMcpContext {
            is_unpromoted_subagent: false,
            ..context(true, 0)
        };
        let names_before = tool_names(&build_tool_list(&unpromoted_subagent_context()))
            .into_iter()
            .map(str::to_string)
            .collect::<Vec<_>>();
        let tools_after = build_tool_list(&promoted);
        let names_after = tool_names(&tools_after);

        assert!(!names_before.iter().any(|name| name == "spawn_subagent"));
        assert!(names_after.contains(&"spawn_subagent"));
        assert!(names_after.contains(&"get_subagent_launch_options"));
    }

    #[test]
    fn a_capped_parent_still_sees_its_launch_options() {
        // `can_create` is false at the fanout cap too, and that parent is NOT
        // subordinate — withholding the option description there would hide the
        // limit it is bumping against.
        let tools = build_tool_list(&context(false, 8));
        let names = tool_names(&tools);

        assert!(names.contains(&"get_subagent_launch_options"));
        assert!(!names.contains(&"spawn_subagent"));
    }

    #[test]
    fn spawn_style_names_cover_the_deprecated_create_alias() {
        // The dispatch gate matches wire names, so the old name has to be here
        // or a launch-frozen subagent walks straight through it.
        assert!(is_spawn_style_tool("create_subagent"));
        assert!(is_spawn_style_tool("spawn_subagent"));
        assert!(is_spawn_style_tool("get_subagent_launch_options"));
        // Ruling 3 says ANY spawn-style tool, and spawning a peer is the most
        // spawn-style thing there is: an unpromoted subagent that could reach
        // this would be spawning its way around the block it is under.
        assert!(is_spawn_style_tool("spawn_agent"));
        assert!(!is_spawn_style_tool("send_agent_message"));
        assert!(!is_spawn_style_tool("close_agent"));
        for (alias, canonical) in DEPRECATED_TOOL_ALIASES {
            if is_spawn_style_tool(canonical) {
                assert!(
                    is_spawn_style_tool(alias),
                    "alias {alias} escapes the spawn gate its canonical {canonical} is under"
                );
            }
        }
    }

    // --- spawn_agent (ADR §3.4, ruling 9) --------------------------------

    #[test]
    fn an_unpromoted_subagent_is_offered_no_way_to_spawn_a_peer_either() {
        let names = tool_names(&build_tool_list(&unpromoted_subagent_context()))
            .into_iter()
            .map(str::to_string)
            .collect::<Vec<_>>();

        assert!(
            !names.iter().any(|name| name == "spawn_agent"),
            "spawn_agent is advertised to an unpromoted subagent"
        );
        // And the gate that actually binds, since the list above is frozen at
        // launch: dispatch refuses the wire name.
        assert!(is_spawn_style_tool("spawn_agent"));
    }

    #[test]
    fn a_capped_parent_can_still_spawn_a_peer() {
        // Ruling 9: the cap of eight bounds LINKED children. An owned agent is
        // not one, so the fanout cap must not reach it — which is the whole
        // reason `can_spawn_agent` is not derived from `can_create`.
        let capped = build_tool_list(&context(false, 8));
        let names = tool_names(&capped);

        assert!(
            !names.contains(&"spawn_subagent"),
            "the cap still bites subagents"
        );
        assert!(names.contains(&"spawn_agent"));
    }

    #[test]
    fn spawn_agent_is_withheld_when_the_caller_itself_cannot_create_agents() {
        // Not a cap — the caller's own state (closed, disabled, an ineligible
        // or unwritable workspace) is what `can_spawn_agent` reports.
        let blocked = AgentOpsMcpContext {
            can_spawn_agent: false,
            spawn_agent_block_reason: Some("subagents are disabled for this session".to_string()),
            ..context(true, 0)
        };

        assert!(!tool_names(&build_tool_list(&blocked)).contains(&"spawn_agent"));
    }

    #[test]
    fn spawn_agent_takes_the_subagent_launch_vocabulary_plus_a_workspace() {
        let spawn = build_tool_list(&context(true, 1))
            .into_iter()
            .find(|tool| tool.get("name").and_then(Value::as_str) == Some("spawn_agent"))
            .expect("spawn_agent is advertised");

        for field in [
            "prompt",
            "label",
            "harnessId",
            "initialConfig",
            "wakeOnCompletion",
        ] {
            assert!(
                spawn
                    .pointer(&format!("/inputSchema/properties/{field}"))
                    .is_some(),
                "spawn_agent does not accept {field}, which spawn_subagent does"
            );
        }
        // ADR §3.4 names `workspaceId`. It is accepted so that passing it is an
        // explicit refusal rather than a silent spawn somewhere else.
        assert!(spawn
            .pointer("/inputSchema/properties/workspaceId")
            .is_some());
        assert_eq!(
            spawn
                .pointer("/inputSchema/required")
                .and_then(Value::as_array)
                .map(|required| required.len()),
            Some(1),
            "only the first message is required"
        );
    }

    #[test]
    fn spawn_agent_leases_in_the_call_because_it_can_create_in_another_workspace() {
        // It used to lease at the route, back when the only workspace it could
        // reach was the caller's. `spawn_workspace` changed that: the session it
        // creates lands in the TARGET workspace, and it is the TARGET's retire
        // preflight that has to see the work — so it takes that lease itself,
        // like `send_agent_message`. Re-adding it here would take the CALLER's
        // lease, which for a cross-workspace spawn fences the wrong workspace.
        assert!(!MUTATING_TOOL_NAMES.contains(&"spawn_agent"));
        // `spawn_subagent` still leases at the route: a subagent is always in
        // the caller's own workspace, which is the one in the URL.
        assert!(MUTATING_TOOL_NAMES.contains(&"spawn_subagent"));
        assert!(MUTATING_TOOL_NAMES.contains(&"create_subagent"));
    }

    // --- workspace spawn (ADR §3.4, §6 step 7) ---------------------------

    #[test]
    fn spawning_a_workspace_takes_no_route_lease_because_there_is_nothing_to_lease() {
        // A workspace operation lease is keyed by workspace id, and the
        // workspace this creates has no id until it exists. The route would
        // therefore lease the CALLER's workspace, which is not what is being
        // mutated. It gates on the repo root's access state in-call instead —
        // the same thing `POST /v1/workspaces/worktrees` does.
        assert!(!MUTATING_TOOL_NAMES.contains(&"spawn_workspace"));
        // Read-only, like every other `get_*` on this server.
        assert!(!MUTATING_TOOL_NAMES.contains(&"get_workspace_options"));
    }

    #[test]
    fn both_workspace_tools_are_spawn_style() {
        // Ruling 3 lists workspaces alongside subagents and agents, and the
        // gate that binds is the dispatch one, so both wire names must be here.
        assert!(is_spawn_style_tool("spawn_workspace"));
        assert!(is_spawn_style_tool("get_workspace_options"));
    }

    #[test]
    fn spawn_workspace_takes_the_three_arguments_the_adr_allows() {
        let spawn = build_tool_list(&context(true, 0))
            .into_iter()
            .find(|tool| tool.get("name").and_then(Value::as_str) == Some("spawn_workspace"))
            .expect("spawn_workspace is advertised");

        for field in ["repoRootId", "mode", "branchName"] {
            assert!(
                spawn
                    .pointer(&format!("/inputSchema/properties/{field}"))
                    .is_some(),
                "spawn_workspace does not accept {field}"
            );
        }
        // Everything else about workspace creation is server-side policy: the
        // ADR rejects exposing conflict policy, checkout mode or the setup
        // script to agents, so their presence here would be a scope leak.
        for withheld in [
            "setupScript",
            "nameConflictPolicy",
            "checkoutMode",
            "baseBranch",
            "targetPath",
            "surface",
        ] {
            assert!(
                spawn
                    .pointer(&format!("/inputSchema/properties/{withheld}"))
                    .is_none(),
                "spawn_workspace exposes {withheld}, which is server-side policy"
            );
        }
        // Every argument is optional: the default is a worktree off the
        // caller's own repo.
        assert!(spawn.pointer("/inputSchema/required").is_none());
        assert_eq!(
            spawn
                .pointer("/inputSchema/properties/mode/enum")
                .and_then(Value::as_array)
                .map(|values| values.iter().filter_map(Value::as_str).collect::<Vec<_>>()),
            Some(vec!["worktree", "local"])
        );
    }

    #[test]
    fn an_unpromoted_subagent_is_offered_no_way_to_spawn_a_workspace() {
        let names = tool_names(&build_tool_list(&unpromoted_subagent_context()))
            .into_iter()
            .map(str::to_string)
            .collect::<Vec<_>>();

        assert!(!names.iter().any(|name| name == "spawn_workspace"));
        assert!(!names.iter().any(|name| name == "get_workspace_options"));
    }

    #[test]
    fn a_capped_parent_can_still_spawn_a_workspace() {
        // The fanout cap bounds LINKED children (ruling 9). A workspace is not
        // one, so the cap must not reach it.
        let names = tool_names(&build_tool_list(&context(false, 8)))
            .into_iter()
            .map(str::to_string)
            .collect::<Vec<_>>();

        assert!(names.iter().any(|name| name == "spawn_workspace"));
        assert!(names.iter().any(|name| name == "get_workspace_options"));
    }

    /// Ruling 11: workspaces an agent spawns are retired by PEOPLE. Nothing on
    /// this server may undo one, and this is the ratchet that says so — a tool
    /// named for removal would have to be added here deliberately, which is the
    /// point at which somebody has to re-read the ruling.
    #[test]
    fn no_agent_ops_tool_can_retire_or_delete_a_workspace() {
        let advertised = tool_names(&build_tool_list(&context(true, 3)))
            .into_iter()
            .map(str::to_string)
            .collect::<Vec<_>>();
        let every_name = advertised
            .iter()
            .map(String::as_str)
            .chain(MUTATING_TOOL_NAMES.iter().copied())
            .chain(SPAWN_STYLE_TOOL_NAMES.iter().copied())
            .chain(DEPRECATED_TOOL_ALIASES.iter().map(|(alias, _)| *alias));

        for name in every_name {
            for forbidden in ["retire", "purge", "delete_workspace", "remove_workspace"] {
                assert!(
                    !name.contains(forbidden),
                    "agent ops advertises {name}, which looks like workspace removal — ruling 11 \
                     keeps retirement human-only"
                );
            }
        }
        // And the dispatch surface itself never reaches the destruction paths.
        let calls = std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("src/domains/sessions/agent_ops/workspace_ops.rs"),
        )
        .expect("read workspace_ops.rs");
        for forbidden in [
            "retire_workspace",
            "WorkspaceRetireService",
            "WorkspacePurgeService",
            "delete_workspace",
        ] {
            assert!(
                !calls.contains(forbidden),
                "workspace_ops.rs references {forbidden}; ruling 11 keeps retirement human-only"
            );
        }
    }

    #[test]
    fn every_advertised_spawn_tool_is_inside_the_spawn_gate() {
        // `SPAWN_STYLE_TOOL_NAMES` is the whole of ruling 3's enforcement and
        // it is hand-maintained. `spawn_agent` and `spawn_workspace` land in
        // later steps; if one is advertised and not listed here, an unpromoted
        // subagent silently regains a spawn tool and nothing fails. So the list
        // is ratcheted against the advertisement: anything named `spawn_*` that
        // a top-level caller is offered must be gated.
        let advertised = build_tool_list(&context(true, 0));
        for name in tool_names(&advertised) {
            if name.starts_with("spawn_") {
                assert!(
                    is_spawn_style_tool(name),
                    "{name} is advertised but missing from SPAWN_STYLE_TOOL_NAMES, so an \
                     unpromoted subagent could call it"
                );
            }
        }
        // The gate is not vacuous: the current list really does hold one.
        assert!(tool_names(&advertised)
            .iter()
            .any(|name| name.starts_with("spawn_")));
    }

    #[test]
    fn close_agent_leases_in_the_call_because_it_takes_the_targets_permit() {
        // A close acts on the TARGET session, so it takes that session's
        // mutation permit — which must be outside any workspace lease
        // (PR1227-LOCK-01). A route-level lease would be taken first and invert
        // the order. It is also the caller's workspace, and the target need not
        // be in it.
        assert!(!MUTATING_TOOL_NAMES.contains(&"close_agent"));
        assert!(!MUTATING_TOOL_NAMES.contains(&"close_subagent"));
        // Promotion only stamps the caller's own link row, in the caller's own
        // workspace, and touches no session actor: the route lease is right.
        assert!(MUTATING_TOOL_NAMES.contains(&"promote_subagent"));
    }

    #[test]
    fn promote_and_close_are_offered_to_anyone_who_owns_agents() {
        for ctx in [context(true, 0), context(false, 3)] {
            let names_owned = tool_names(&build_tool_list(&ctx))
                .into_iter()
                .map(str::to_string)
                .collect::<Vec<_>>();

            assert!(names_owned.iter().any(|name| name == "promote_subagent"));
            assert!(names_owned.iter().any(|name| name == "close_agent"));
        }

        // Owning nothing and unable to spawn: nothing to promote or close.
        let names = tool_names(&build_tool_list(&unpromoted_subagent_context()))
            .into_iter()
            .map(str::to_string)
            .collect::<Vec<_>>();
        assert!(!names.iter().any(|name| name == "promote_subagent"));
        assert!(!names.iter().any(|name| name == "close_agent"));
    }

    #[test]
    fn close_agent_takes_a_session_id_and_an_optional_reason() {
        let close = build_tool_list(&context(true, 1))
            .into_iter()
            .find(|tool| tool.get("name").and_then(Value::as_str) == Some("close_agent"))
            .expect("close_agent is advertised");

        assert!(close
            .pointer("/inputSchema/properties/sessionId")
            .is_some());
        assert!(close.pointer("/inputSchema/properties/reason").is_some());
        // `subagentId` survives for sessions still holding the pre-agent-ops
        // `close_subagent` schema.
        assert!(close
            .pointer("/inputSchema/properties/subagentId")
            .is_some());
        // Neither target spelling is required: the call resolves whichever came.
        assert!(close.pointer("/inputSchema/required").is_none());
    }
}
