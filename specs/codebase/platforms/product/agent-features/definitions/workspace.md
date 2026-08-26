# Workspace Product MCP

> Ownership: this document is the depth reference for the **subagents** system spec ([README.md](../../../../systems/runtime/subagents/README.md)). Laws, owned state, fences and the checked code map are authoritative there; flow-level detail stays here.

Status: authoritative current definition for the Workspace product MCP,
session attachment, current-role authorization, and agent product context.

Workspace is the agent-facing surface for discovering and pinning workspaces,
discovering agents, creating and configuring agents, messaging them, and
managing delegated-agent lifecycle. A delegated agent remains a normal durable
session. Its authority comes from current workspace and relationship state,
not from the role it had when its MCP capability token was minted.

The stable product MCP id and generic endpoint route slug are `workspace`.
The ACP-visible server name is `proliferate_workspace`, so native tool names
use the `mcp__proliferate_workspace__<tool>` namespace. Binding summaries keep
the stable id `internal:workspace` while reporting `proliferate_workspace` as
their `serverName`.

## Tool Contract

`initialize` and `tools/list` expose exactly these 20 tools. Argument and return
schemas remain code-owned:

```text
whoami
list_workspaces
list_workspace_options
list_agents
get_agent
list_subagents
list_agent_launch_options
list_agent_config_options
get_task_output
create_workspace
pin_workspace
unpin_workspace
create_agent
configure_agent
resume_agent
send_message
interrupt_agent
close_subagent
open_subagent
promote_subagent
```

There is no compatibility alias from a removed Subagents MCP tool name to a
Workspace tool name. Workspace has no `pause_agent` tool, and Close/Open apply
only to delegated-agent relationships, not ordinary agents.

## Session Attachment

Workspace attaches exactly when:

```rust
workspace.surface == WorkspaceSurface::Standard
    && session.mcp_binding_policy != SessionMcpBindingPolicy::InternalOnly
```

This includes eligible ordinary sessions and durable delegated-agent sessions,
including the same session after promotion or restart. Selection must not use
`subagents_enabled`: Workspace-created delegated agents intentionally have that
legacy flag disabled while still needing Workspace identity, read, messaging,
and parent-owned capabilities.

`InternalOnly` review/workflow sessions and Cowork sessions do not receive
Workspace. Selection happens before actor startup. The actor receives the final
concrete MCP list and does not re-evaluate attachment policy.

The Workspace capability token is scoped to runtime, workspace, session, and
product MCP. It authenticates the calling session but does not cache role or
relationship authority.

## Current Authority

Every `tools/call` resolves current caller role, parent ownership, workspace,
relationship, and target truth before performing behavior. Launch-time context
cannot grant lasting authority.

Consequences:

- a delegated agent cannot create agents or act as an ordinary parent
- a parent can manage only relationships and targets allowed by current
  durable Agent Operations truth
- a committed promotion changes authority for the next call without minting a
  new session identity
- authorization and target-race failures return typed tool errors and perform
  no optimistic relationship mutation
- malformed or stale transcript output is display-only and cannot establish
  relationship authority

Agent Operations owns the role and relationship projection. Session app
composition injects that capability into the live session manager; live actor
code does not derive a second role model or depend on Agent Operations
application composition.

## Client-Local Pin Requests

`pin_workspace` and `unpin_workspace` validate the current caller, capability,
runtime boundary, and exact workspace target. A valid call first persists and
broadcasts a runtime-owned `workspace_pin_intent` session event, then returns
the resolved workspace, the event's UUID `requestId`, the requested `pinned`
state, and `status: "requested"`. Requested does not claim that any client has
applied the preference.

The runtime and server do not own or persist pin state. Each connected product
client accepts only that typed session event from the authenticated live stream
or hydrated history. ACP tool result text and `structuredContent` are display
data and never authorize the preference mutation. The event's
`sourceSessionId` must equal its envelope session, which rejects remapped replay
sessions. Unknown local workspace targets cannot mutate preferences. The client
expands logical workspace aliases and applies the request to its device-local
`workspace_ui` preferences. The authenticated reconciliation owner buffers at
most 128 unresolved startup events. Persisted sets retain at most 256 latest
request receipts, keyed by runtime, session, and logical target, and 256 latest
renderer-local manual/live ordering barriers, keyed by logical workspace
identity. The current renderer also retains at most 256 resolved-history
observation marks so a delayed older history target cannot overwrite later
cross-session history after alias resolution; those marks reset on hydration
because renderer sequence numbers are not comparable across restarts. Manual
choices create a persisted barrier. History observations under one and live
observations captured before it are acknowledged without mutating the
preference; a newly observed live request may supersede and advance it.
Sequence comparison remains scoped to one session and target, while
cross-session requests retain renderer observation order.
Every client that observes the event reconciles it against its local ordering
barriers; the tool does not promise cross-device synchronization.

## Per-Turn Product Context

Every supported harness receives concise generic Workspace guidance through
the product-MCP launch integration. Immediately before every prompt render, the
live session manager resolves current durable role and relationship truth and
adds a separate block beginning:

```text
System instruction from AnyHarness, not user content:
```

The authored prompt, including its persisted initial-task text, remains
verbatim. The metadata-derived system block is not inserted into or persisted
as authored user content.

Delegated-agent context:

- identifies the current parent
- states that the terminal assistant message is relayed to the parent
- forbids creating agents
- requests a concise completion report with absolute paths and no standalone
  report file

Ordinary-agent context omits parent, restriction, and relay claims. Promotion
therefore changes the next turn's context without restarting or replacing the
session and without mutating earlier transcript content. Agent-origin messages
continue to identify their sender from durable provenance.

Workspace guidance and current-role context are not a product skill. A skill
is for optional workflow instruction; current authorization and mutable role
truth are mandatory runtime inputs.

## Fail-Closed Behavior

### Attachment failure

A Workspace selector, assembly, or token-mint failure fails session startup
with:

```text
HTTP status: 500
code: WORKSPACE_MCP_ATTACHMENT_FAILED
detail: Workspace MCP could not be attached to the session.
instance: urn:proliferate:anyharness:incident:<uuid-v4>
```

The failure must not silently omit Workspace, report a stale `Applied` binding
summary, restore the legacy Subagents MCP, expose internal selector/token
detail, or start ACP. Create, resume, lazy prompt-start, and Workspace
`create_agent` preserve this typed failure. A later explicit retry re-runs
selection and token mint.

### Product-context failure

A failure to resolve current product context fails that prompt turn with:

```text
HTTP status: 503
code: AGENT_PRODUCT_CONTEXT_UNAVAILABLE
detail: Agent product context is temporarily unavailable; retry the prompt.
instance: urn:proliferate:anyharness:incident:<uuid-v4>
```

The runtime sends neither stale nor role-ambiguous instructions.

For a direct prompt, the failure occurs before `TurnStarted`, before a user
transcript item, and before ACP/model dispatch. A later retry re-resolves
current truth.

For an already accepted queued prompt, the runtime:

1. retains the same durable queue row;
2. emits exactly one durable `ErrorEvent` with the stable code and bounded
   fixed message;
3. uses the event envelope `itemId` as the incident UUID and receipt; and
4. unloads the actor to prevent a hot retry loop.

The next explicit activation re-resolves current truth and retries that same
queue head. This behavior reuses `ProblemDetails.instance`, `ErrorEvent.code`,
and event `itemId`; it adds no public error schema. Error receipts and logs must
not contain prompt content or raw internal error detail.

## Replacement And Retention Boundary

Workspace activation replaced and removed:

- `domains/sessions/subagents/mcp/**`, its auth secret, registration, legacy
  admission proof, and product-catalog selection
- every `mcp__subagents__*` reducer, stream, transcript, motion, and
  presentation branch plus compatibility-only tests and fixtures
- Subagents-MCP wake tools, one-shot scheduling calls, selectors, launch
  metadata, SDK aliases, presentation, and subagent-owned schedule access

No alias preserves a removed Subagents tool name.

The current implementation retains:

- Workspace create, configure, messaging, interrupt, Close, Open, and Promote
  behavior and strict live/history receipt correlation
- Workspace pin and unpin validation, runtime-owned live/history intent events,
  replay rejection, alias expansion, and device-local preference application
- `PromptProvenance::SubagentWake`, `persist_subagent_wake_turn`, durable
  completion delivery, automatic parent notifications, and delegated-work
  notification rendering; these are completion admission/provenance, not the
  removed one-shot Subagents-MCP wake mechanism
- user-facing roster and lifecycle endpoints and their generated SDKs
- Cowork session-link wake behavior and the shared
  `session_link_wake_schedules` persistence and mobility wire contracts
- child session history and transcript artifacts according to retention policy

No delegated-agent relationship may create or read a one-shot wake schedule.
The shared wake table remains because Cowork owns active behavior on it;
runtime access sits behind Cowork's delegation service, and mobility accepts
only Cowork-linked schedule rows.

Closing a relationship is not transcript or child-session deletion. Promotion
removes the parent/child relationship and active delegated-agent roster entry
while preserving the same durable session as an ordinary session.

## Acceptance

The Workspace contract is complete when tests and live proof establish:

- selection attaches Workspace for Standard ordinary, delegated, and
  promoted/restarted sessions, and excludes `InternalOnly` review/workflow and
  Cowork sessions
- attachment failures have the exact bounded 500 receipt above, start no ACP,
  expose no internals, leave no stale binding summary, and succeed on a later
  valid retry
- `initialize` and `tools/list` expose exactly the 20 tools, with a valid call
  for each, malformed-input coverage for each schema, applicable caller/target
  denials, and representative domain failures by operation family
- every turn resolves ordinary or delegated context immediately before render;
  promotion changes the next turn without restart; the system block is placed
  separately; and authored prompts remain byte-for-byte unchanged
- direct and queued context failures obey the exact 503 receipt, dispatch,
  persistence, unload, and later-retry laws above
- Workspace create and promote receipts retain strict live/history authority
  after legacy presentation branches are removed
- Workspace pin and unpin events validate the exact target, source session, and
  request state; live and hydrated-history application converges once per
  runtime request and target, tolerates delayed different-target history, and
  cannot replay over a later manual pin change
- committed completion delivery survives restart, appears once to the parent,
  and converges without a duplicate replay
- replacement searches find no production `mcp__subagents__*` branch,
  Subagents MCP registration/auth/definition/tool/alias, or delegated-agent
  one-shot wake path, while Cowork wake storage and behavior still pass
- mobility export, import, and preflight preserve Cowork wake schedules without
  granting delegated-agent access
- adapter injection works for every supported harness, and live probes exercise
  all harnesses reported ready while recording unavailable harnesses and reasons
