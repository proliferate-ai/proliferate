# Cowork Product MCP

Status: authoritative target definition for cowork workspace delegation,
cowork agents, and cowork MCP cleanup.

## Purpose

The Cowork product MCP lets an agent create managed workspaces and run delegated
agents inside those workspaces. It uses the same child-agent lifecycle as
subagents, with one extra scope layer:

```text
choose or create a managed cowork workspace
create an agent inside that workspace
send it work
optionally wake me when it finishes
read the latest useful result
close it when I am done with it
```

Cowork should not have a second lifecycle vocabulary. A cowork agent is a
delegated child session running in a managed workspace.

## Product Model

```text
CoworkWorkspace
  coworkWorkspaceId
  workspaceId
  sourceWorkspaceId
  label
  workspaceName
  branchName
  path
  status
  readiness
  agents

CoworkAgent
  coworkAgentId
  label
  status
  coworkWorkspaceId
  workspaceId
  harnessId
  appliedInitialConfig
  wake state
  latest turn summary
  transcript/event cursors
  closed/deleted state
```

Identity fields:

| Field | Meaning | Normal exposure |
| --- | --- | --- |
| `coworkWorkspaceId` | Stable product handle for the managed workspace relationship. | MCP args/responses, UI routing |
| `workspaceId` | AnyHarness workspace id for opening the workspace. | UI routing, MCP responses |
| `coworkAgentId` | Stable handle for one delegated agent in a cowork workspace. | MCP args/responses, UI data model |
| `label` | Product title for the workspace or agent. | Tool responses, tabs, sidebar, popovers |
| `avatarName` | Deterministic friendly display name, such as `Mary`. | UI hover/tooltip only |
| `childSessionId` | Runtime session id for the delegated agent. | Internal/debug/details only |
| `sessionLinkId` | Durable parent-child relationship row id. | Internal/debug/details only |

The old `codingSessionId` concept should collapse into `coworkAgentId` for the
normal agent-facing API. Compatibility aliases may exist during migration, but
new tool contracts should use cowork workspace/agent language.

During the migration window, MCP responses may still include legacy
`codingSessionId` and `sessionLinkId` fields so older transcript parsers, SDKs,
and in-flight agent sessions keep working. New callers should treat those
fields as compatibility aliases only. All examples and new code should prefer
`coworkWorkspaceId`/`coworkAgentId` plus `label`.

## MCP Identity

```text
id: cowork
owner: domains/cowork
implementation: anyharness-lib/src/domains/cowork/mcp/**
route slug: cowork
server name: proliferate-cowork
visibility: internal
default injection: cowork-enabled parent sessions and cowork product sessions
```

Cowork artifact tools and cowork workspace-delegation tools can share the same
MCP server, but their contracts should remain distinct.

## Capability And Auth

Every cowork MCP call is authorized against:

```text
workspace_id
parent_session_id
product_mcp_id: cowork
workspace_delegation_enabled
```

Workspace and agent access is checked by the cowork domain on every call:

- a parent can only manage cowork workspaces it owns
- a parent can only manage cowork agents linked to its owned cowork workspaces
- cowork-created child agents cannot create their own nested cowork workspaces
  unless a future policy explicitly enables that

## Tool Contract

All cowork tools accept and return JSON objects. Workspace tools own workspace
lifecycle. Agent tools mirror the subagent lifecycle with a workspace scope.

Compatibility rule:

- accept `codingSessionId` during migration when a caller does not yet know
  `coworkAgentId`
- if both `coworkAgentId` and `codingSessionId` are supplied, they must resolve
  to the same linked cowork agent or the call returns a validation error
- return legacy ids only as compatibility fields; do not require new callers
  to store or echo them

Current migration response shape:

- create/send/status/wake/close responses include `coworkAgentId` and `label`,
  and may also include `codingSessionId` and `sessionLinkId`
- `read_cowork_agent_latest_turns` currently returns completion metadata
  (`childTurnId`, `outcome`, `createdAt`, `childLastEventSeq`,
  `parentEventSeq`, `parentPromptSeq`) rather than the full summarized
  assistant-result target shape
- `search_cowork_agent_transcript` returns `query`, `seq`, `timestamp`,
  `turnId`, `itemId`, and `snippet`
- `read_cowork_agent_events` is a debug escape hatch and may return only raw
  event cursors plus legacy child routing fields

These compatibility fields are not the agent-facing handle. The agent-facing
handle remains `coworkAgentId`.

### Workspace Tools

#### `get_cowork_workspace_launch_options`

Returns source workspaces and defaults for creating managed cowork workspaces.

Args:

```json
{
  "sourceWorkspaceIds": ["workspace_source_123"]
}
```

`sourceWorkspaceIds` is optional. If omitted, return all eligible source
workspaces for this parent session.

Returns:

```json
{
  "canCreate": true,
  "blockedReason": null,
  "limits": {
    "maxManagedWorkspaces": 4,
    "activeManagedWorkspaces": 1,
    "maxAgentsPerWorkspace": 4
  },
  "sourceWorkspaces": [
    {
      "sourceWorkspaceId": "workspace_source_123",
      "displayName": "Proliferate",
      "path": "/Users/pablo/proliferate",
      "repoRootId": "repo_123",
      "baseBranch": "main",
      "createBlockReason": null
    }
  ],
  "branchDefaults": {
    "prefix": "cowork/",
    "strategy": "derive_from_label"
  }
}
```

#### `create_cowork_workspace`

Creates a managed workspace. This provisions the workspace only; it does not
start agent work.

Args:

```json
{
  "sourceWorkspaceId": "workspace_source_123",
  "label": "Auth Workspace",
  "workspaceName": "auth-workspace",
  "branchName": "cowork/auth-workspace"
}
```

Required:

```text
sourceWorkspaceId
```

Optional:

```text
label
workspaceName
branchName
```

Returns:

```json
{
  "coworkWorkspaceId": "cowork_workspace_abc123",
  "workspaceId": "workspace_456",
  "sourceWorkspaceId": "workspace_source_123",
  "label": "Auth Workspace",
  "workspaceName": "auth-workspace",
  "branchName": "cowork/auth-workspace",
  "status": "ready",
  "workspaceLink": {
    "label": "Open workspace",
    "available": true
  }
}
```

#### `list_cowork_workspaces`

Lists managed cowork workspaces and their linked agents.

Args:

```json
{
  "includeClosed": false
}
```

Returns:

```json
{
  "workspaces": [
    {
      "coworkWorkspaceId": "cowork_workspace_abc123",
      "workspaceId": "workspace_456",
      "label": "Auth Workspace",
      "status": "ready",
      "workspaceLink": {
        "label": "Open workspace",
        "available": true
      },
      "agents": [
        {
          "coworkAgentId": "cowork_agent_123",
          "label": "Auth Implementation",
          "status": "running"
        }
      ]
    }
  ]
}
```

#### `get_cowork_workspace_status`

Returns workspace readiness and live summary.

Args:

```json
{
  "coworkWorkspaceId": "cowork_workspace_abc123"
}
```

Returns:

```json
{
  "coworkWorkspaceId": "cowork_workspace_abc123",
  "workspaceId": "workspace_456",
  "label": "Auth Workspace",
  "status": "ready",
  "workspaceLink": {
    "label": "Open workspace",
    "available": true
  },
  "agents": []
}
```

#### `close_cowork_workspace`

Removes a managed workspace from active delegated-work context. If it has
running agents, active work ends after confirmation in UI or explicit agent
tool invocation.

Args:

```json
{
  "coworkWorkspaceId": "cowork_workspace_abc123"
}
```

Returns:

```json
{
  "coworkWorkspaceId": "cowork_workspace_abc123",
  "workspaceId": "workspace_456",
  "label": "Auth Workspace",
  "closed": true,
  "activeWorkEnded": true
}
```

Closing is not workspace directory deletion unless a future destructive action
explicitly says so.

### Agent Tools

Cowork agent tools mirror the subagent tools. The only required addition at
creation time is the target cowork workspace.

#### `get_cowork_agent_launch_options`

Returns the launch catalog available inside a managed cowork workspace.

Args:

```json
{
  "coworkWorkspaceId": "cowork_workspace_abc123",
  "harnessIds": ["claude"]
}
```

Returns:

```json
{
  "coworkWorkspaceId": "cowork_workspace_abc123",
  "workspaceId": "workspace_456",
  "canCreate": true,
  "blockedReason": null,
  "limits": {
    "maxAgentsPerWorkspace": 4,
    "activeAgents": 1
  },
  "defaultHarnessId": "claude",
  "harnesses": [
    {
      "harnessId": "claude",
      "displayName": "Claude",
      "defaultInitialConfig": {
        "model": "claude-sonnet-4-5",
        "mode": "bypassPermissions",
        "effort": "medium"
      },
      "initialConfigSchema": {
        "type": "object"
      }
    }
  ]
}
```

There are no top-level `modelId` or `modeId` fields in cowork agent tools.
Harness-specific launch configuration is carried through `initialConfig`.

#### `create_cowork_agent`

Creates a delegated agent session inside a managed cowork workspace and sends
the initial prompt.

Args:

```json
{
  "coworkWorkspaceId": "cowork_workspace_abc123",
  "label": "Auth Implementation",
  "harnessId": "claude",
  "initialConfig": {
    "model": "claude-sonnet-4-5",
    "mode": "bypassPermissions",
    "effort": "medium"
  },
  "prompt": "Implement the auth middleware changes in this workspace.",
  "wakeOnCompletion": true
}
```

Required:

```text
coworkWorkspaceId
prompt
```

`prompt` is validated with `prompt.trim().is_empty()`, but the original prompt
string is preserved when it is sent to the cowork agent.

Returns:

```json
{
  "coworkAgentId": "cowork_agent_123",
  "coworkWorkspaceId": "cowork_workspace_abc123",
  "workspaceId": "workspace_456",
  "label": "Auth Implementation",
  "status": "running",
  "sessionLink": {
    "label": "Open agent session",
    "available": true
  },
  "workspaceLink": {
    "label": "Open workspace",
    "available": true
  },
  "appliedInitialConfig": {
    "model": "claude-sonnet-4-5",
    "mode": "bypassPermissions",
    "effort": "medium"
  },
  "wakeOnCompletion": {
    "scheduled": true
  },
  "next": {
    "readTool": "read_cowork_agent_latest_turns",
    "coworkAgentId": "cowork_agent_123"
  }
}
```

#### `list_cowork_agents`

Lists cowork agents owned by this parent, optionally scoped to one managed
workspace.

Args:

```json
{
  "coworkWorkspaceId": "cowork_workspace_abc123",
  "includeClosed": false
}
```

Returns:

```json
{
  "agents": [
    {
      "coworkAgentId": "cowork_agent_123",
      "coworkWorkspaceId": "cowork_workspace_abc123",
      "workspaceId": "workspace_456",
      "label": "Auth Implementation",
      "status": "running",
      "wakeScheduled": true,
      "sessionLink": {
        "label": "Open agent session",
        "available": true
      },
      "workspaceLink": {
        "label": "Open workspace",
        "available": true
      }
    }
  ]
}
```

#### `send_cowork_agent_message`

Sends a follow-up prompt to a cowork agent. If the child is currently running,
the message is queued.

Args:

```json
{
  "coworkAgentId": "cowork_agent_123",
  "prompt": "Also update the integration tests.",
  "wakeOnCompletion": true
}
```

Returns:

```json
{
  "coworkAgentId": "cowork_agent_123",
  "label": "Auth Implementation",
  "status": "running",
  "messageStatus": "queued",
  "wakeOnCompletion": {
    "scheduled": true
  },
  "sessionLink": {
    "label": "Open agent session",
    "available": true
  }
}
```

#### `schedule_cowork_agent_wake`

Schedules a one-shot parent wake after the cowork agent's next newly completed
turn.

Args:

```json
{
  "coworkAgentId": "cowork_agent_123"
}
```

Returns:

```json
{
  "coworkAgentId": "cowork_agent_123",
  "label": "Auth Implementation",
  "scheduled": true,
  "alreadyScheduled": false
}
```

#### `get_cowork_agent_status`

Returns current live/product state for one cowork agent.

Args:

```json
{
  "coworkAgentId": "cowork_agent_123"
}
```

Returns:

```json
{
  "coworkAgentId": "cowork_agent_123",
  "coworkWorkspaceId": "cowork_workspace_abc123",
  "workspaceId": "workspace_456",
  "label": "Auth Implementation",
  "status": "running",
  "harnessId": "claude",
  "appliedInitialConfig": {
    "model": "claude-sonnet-4-5",
    "mode": "bypassPermissions",
    "effort": "medium"
  },
  "wakeScheduled": true,
  "queuedMessages": 0,
  "latestTurn": null,
  "sessionLink": {
    "label": "Open agent session",
    "available": true
  },
  "workspaceLink": {
    "label": "Open workspace",
    "available": true
  }
}
```

#### `read_cowork_agent_latest_turns`

Common result-reading path.

Args:

```json
{
  "coworkAgentId": "cowork_agent_123",
  "limit": 3
}
```

Returns:

```json
{
  "coworkAgentId": "cowork_agent_123",
  "label": "Auth Implementation",
  "turns": [
    {
      "turnId": "turn_123",
      "status": "completed",
      "assistantSummary": "Implemented middleware and added integration tests.",
      "importantToolErrors": []
    }
  ]
}
```

During migration, this response may also include `codingSessionId` and
`sessionLinkId` as legacy routing aliases. The stable fields remain
`coworkAgentId` and `label`.

#### `search_cowork_agent_transcript`

Grep path for one cowork agent transcript.

Args:

```json
{
  "coworkAgentId": "cowork_agent_123",
  "query": "middleware",
  "limit": 10
}
```

Returns:

```json
{
  "coworkAgentId": "cowork_agent_123",
  "label": "Auth Implementation",
  "query": "middleware",
  "matches": [
    {
      "turnId": "turn_123",
      "eventSeq": 42,
      "snippet": "Updated the auth middleware integration path..."
    }
  ]
}
```

During migration, this response may also include `codingSessionId` and
`sessionLinkId`.

#### `read_cowork_agent_events`

Advanced/debug escape hatch for bounded sanitized raw events.

Args:

```json
{
  "coworkAgentId": "cowork_agent_123",
  "sinceSeq": 42,
  "limit": 100
}
```

#### `close_cowork_agent`

Deletes/closes one cowork agent relationship from active delegated-work state.

Args:

```json
{
  "coworkAgentId": "cowork_agent_123"
}
```

Returns:

```json
{
  "coworkAgentId": "cowork_agent_123",
  "label": "Auth Implementation",
  "closed": true,
  "activeWorkEnded": true
}
```

Close ordering is intentionally retryable: the runtime closes the child session
graph first, including any delegated descendants and product close hooks, then
marks the cowork-agent link closed. If closing the live session fails, the
active link remains discoverable so a later close call can retry rather than
orphaning hidden work.

## Artifact Tools

Cowork artifact tools remain separate from workspace/agent lifecycle tools:

```text
create_artifact
update_artifact
delete_artifact
list_artifacts
get_artifact
```

Artifact tools operate in the current cowork workspace/artifact namespace. They
should not be used to manage delegated agent lifecycle.

## Tool Call Presentation

Workspace creation:

```text
Auth Workspace created
Branch cowork/auth-workspace
Open workspace
```

Agent creation:

```text
Auth Implementation agent created
Running - Auth Workspace - Claude
Open agent session
```

Message send:

```text
Message sent to Auth Implementation
Queued while the agent is running
Open agent session
```

The rendered title should match the `label` the parent agent sees in MCP
results. Raw session/link ids are hidden from normal presentation.

## UI Contract

Cowork appears in delegated-work UI as a workspace row with child agents.

```text
Agents

Running
  Auth Workspace                 2 agents       Open workspace
    Auth Implementation          Running        Open
    Auth Tests                   Queued         Open
```

Rules:

- The parent session tab remains the anchor.
- The cowork workspace contributes delegated-work presence to the right side of
  the parent tab.
- Open cowork agent tabs appear immediately to the right of the parent session,
  inside the parent's attached-agent run.
- Workspace rows open the workspace.
- Agent rows open the agent session.
- Delete workspace confirms if active cowork agents will be ended.
- Delete agent follows the same semantics as subagent deletion.

## Source Ownership

Cowork runtime/domain:

```text
anyharness/crates/anyharness-lib/src/domains/cowork/
  mod.rs
  model.rs
  service.rs
  store.rs
  runtime.rs
  manifest.rs
  artifacts.rs
  delegation/
    mod.rs
    model.rs
    service.rs
  mcp/
    mod.rs
    definition.rs
    auth.rs
    context.rs
    tools.rs
    tools_tests.rs
    calls.rs
    calls_helpers.rs
    calls_tests.rs
```

Shared delegated-session primitives:

```text
anyharness/crates/anyharness-lib/src/sessions/delegation.rs
anyharness/crates/anyharness-lib/src/sessions/subagents/store.rs
anyharness/crates/anyharness-lib/src/domains/sessions/mcp_bindings/**
anyharness/crates/anyharness-lib/src/integrations/mcp/product_server/**
```

HTTP/API/contract:

```text
anyharness/crates/anyharness-lib/src/api/http/cowork.rs
anyharness/crates/anyharness-contract/src/v1/cowork.rs
anyharness/sdk/src/client/cowork.ts
anyharness/sdk/src/types/cowork.ts
anyharness/sdk-react/src/hooks/cowork.ts
```

Persistence:

```text
anyharness/crates/anyharness-lib/src/persistence/sql/0020_cowork_tables.sql
anyharness/crates/anyharness-lib/src/persistence/sql/0029_session_links_prompt_provenance.sql
anyharness/crates/anyharness-lib/src/persistence/sql/0030_subagent_links_and_completions.sql
anyharness/crates/anyharness-lib/src/persistence/sql/0032_cowork_managed_workspaces.sql
anyharness/crates/anyharness-lib/src/persistence/sql/0045_delegated_work_handles_and_closure.sql
```

Frontend:

```text
desktop/src/components/workspace/chat/input/delegated-work/**
desktop/src/components/workspace/shell/tabs/**
desktop/src/hooks/cowork/**
desktop/src/hooks/chat/use-delegated-work-composer.ts
desktop/src/hooks/workspaces/tabs/use-workspace-header-subagent-hierarchy.ts
desktop/src/lib/domain/delegated-work/**
desktop/src/lib/access/anyharness/cowork.ts
```

## Migration Notes

Current coding-session names should migrate to cowork workspace/agent names:

| Old concept | Target concept |
| --- | --- |
| `codingSessionId` | `coworkAgentId` |
| `get_coding_session_launch_options` | `get_cowork_agent_launch_options` |
| `create_coding_session` | `create_cowork_agent` |
| `send_coding_message` | `send_cowork_agent_message` |
| `schedule_coding_wake` | `schedule_cowork_agent_wake` |
| `get_coding_status` | `get_cowork_agent_status` |
| `read_coding_events` | `read_cowork_agent_events` |

Compatibility aliases may exist during migration, but the model-facing and
doc-facing target should use cowork agent names.

## Acceptance

Done when:

- cowork agent lifecycle mirrors subagents
- workspace creation/list/status/close are the only extra lifecycle concepts
- cowork agent tools use `coworkAgentId`, `label`, and `initialConfig`
- top-level `modelId`/`modeId` are replaced by harness `initialConfig`
- `wakeOnCompletion` is advertised on cowork agent create/send
- latest-turn reads and transcript search exist before raw event reads
- common tool responses include `coworkAgentId` and `label`; raw session/link
  ids are compatibility/debug fields only
- close cascades through delegated descendants and only marks links closed
  after session close succeeds
- tool-call UI names and links created workspaces/agents
- cowork appears in delegated-work UI as workspace rows with child agents
