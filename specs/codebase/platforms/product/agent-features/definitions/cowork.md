# Cowork Product MCP

Status: authoritative target definition for cowork workspace delegation,
cowork agents, and cowork MCP cleanup.

A cowork agent is a delegated child session running in a managed workspace,
using the same child-agent lifecycle as subagents plus one extra scope layer
(the managed cowork workspace). Cowork should not have a second lifecycle
vocabulary.

## Identity And Compatibility

| Field | Meaning | Normal exposure |
| --- | --- | --- |
| `coworkWorkspaceId` | Stable product handle for the managed workspace relationship. | MCP args/responses, UI routing |
| `workspaceId` | AnyHarness workspace id for opening the workspace. | UI routing, MCP responses |
| `coworkAgentId` | Stable handle for one delegated agent in a cowork workspace. | MCP args/responses, UI data model |
| `label` | Product title for the workspace or agent. | Tool responses, tabs, sidebar, popovers |
| `avatarName` | Deterministic friendly display name, such as `Mary`. | UI hover/tooltip only |
| `childSessionId` | Runtime session id for the delegated agent. | Internal/debug/details only |
| `sessionLinkId` | Durable parent-child relationship row id. | Internal/debug/details only |

The normal agent-facing API uses `coworkAgentId`. `codingSessionId` and
`sessionLinkId` are compatibility aliases for older transcript parsers, SDKs,
and in-flight agent sessions. New callers should treat those fields as
compatibility aliases only. All examples and new code should prefer
`coworkWorkspaceId`/`coworkAgentId` plus `label`.

Compatibility rule:

- accept `codingSessionId` as a compatibility alias when a caller does not yet
  know `coworkAgentId`
- if both `coworkAgentId` and `codingSessionId` are supplied, they must resolve
  to the same linked cowork agent or the call returns a validation error
- return compatibility ids only as compatibility fields; do not require new
  callers to store or echo them

Compatibility response shape:

- create/send/status/wake/close responses include `coworkAgentId` and `label`,
  and may also include `codingSessionId` and `sessionLinkId`
- `read_cowork_agent_latest_turns` currently returns completion metadata
  (`childTurnId`, `outcome`, `createdAt`, `childLastEventSeq`,
  `parentEventSeq`, `parentPromptSeq`) rather than the full summarized
  assistant-result target shape
- `search_cowork_agent_transcript` returns `query`, `seq`, `timestamp`,
  `turnId`, `itemId`, and `snippet`
- `read_cowork_agent_events` is a debug escape hatch and may return only raw
  event cursors plus compatibility child routing fields

These compatibility fields are not the agent-facing handle. The agent-facing
handle remains `coworkAgentId`.

Old concept -> target concept naming:

| Old concept | Target concept |
| --- | --- |
| `codingSessionId` | `coworkAgentId` |
| `get_coding_session_launch_options` | `get_cowork_agent_launch_options` |
| `create_coding_session` | `create_cowork_agent` |
| `send_coding_message` | `send_cowork_agent_message` |
| `schedule_coding_wake` | `schedule_cowork_agent_wake` |
| `get_coding_status` | `get_cowork_agent_status` |
| `read_coding_events` | `read_cowork_agent_events` |

## Close Ordering

Close ordering is intentionally retryable: the runtime closes the child
session graph first, including any delegated descendants and product close
hooks, then marks the cowork-agent link closed. If closing the live session
fails, the active link remains discoverable so a later close call can retry
rather than orphaning hidden work.

This applies to both `close_cowork_workspace` and `close_cowork_agent`.
