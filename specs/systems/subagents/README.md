# Subagents

Status: current (grade B). System spec in the Organization Standard anatomy.
The runtime system that owns **in-environment delegation**: an agent creating,
configuring, messaging and closing other agents in the *same* workspace,
through the product MCP the runtime attaches to every eligible session. This is
tier one of the two-tier orchestration ruling — fan-out inside one environment,
owned by AnyHarness. Tier two (spawning a new run in a new environment through
the public API) is a control-plane system and is not here.

Today the code is `domains/agent_operations/` (policy, orchestration, the
Workspace MCP) plus the session-owned subdomain `domains/sessions/subagents/`
(durable relationship mechanics and completion delivery). Depth references:
[Workspace Product MCP](workspace-mcp.md)
(the 20-tool contract), the delegated-agents section of
[sessions.md](../sessions/anyharness-sessions.md), [servers.md](product-mcp-servers.md)
(the product-MCP pattern), and the client-side
[delegated-work.md](delegated-work.md).

## 1. Purpose

Let a parent agent run a bounded roster of child agents on the same checkout —
each a normal durable session with its own harness and model — and be woken
exactly once with each child's result, without any of it forking the session
engine. Product outcome: a replay-triage agent fans out eight analysis
subagents, each on a different harness/model, and reads their completions as
ordinary transcript turns.

## 2. Owned state

| State | Where | Written by |
| --- | --- | --- |
| Relationship rows — `session_links` with `relation = subagent` and the `subagent_closed_at` operability marker | sessions' link store, via [subagents/service.rs](../../../anyharness/crates/anyharness-lib/src/domains/sessions/subagents/service.rs) | this system only, atomically with child session insert |
| `session_link_completions` — passive child terminal-turn results | [links/completions](../../../anyharness/crates/anyharness-lib/src/domains/sessions/links) | terminal persistence |
| `session_link_completion_deliveries` — the exactly-once parent-wake ledger (pending → enqueued → delivered, coalesced/suppressed outcomes, removal intents) | SQL in sessions' [store/links.rs](../../../anyharness/crates/anyharness-lib/src/domains/sessions/store/links.rs); driven only by [subagents/delivery/runtime.rs](../../../anyharness/crates/anyharness-lib/src/domains/sessions/subagents/delivery/runtime.rs) | the delivery worker |
| `activity_subagents` — roster projection for the activity feed | activity domain (consumer) | — |
| Workspace pin requests and per-turn product context | [product_context.rs](../../../anyharness/crates/anyharness-lib/src/domains/agent_operations/product_context.rs) | this system |

The roster cap is a product constant: `MAX_SUBAGENTS_PER_PARENT = 8`
([service.rs](../../../anyharness/crates/anyharness-lib/src/domains/sessions/subagents/service.rs)),
counting reversibly-Closed relationships.

## 3. Public surface

**The Workspace product MCP** — id `workspace`, ACP server name
`proliferate_workspace`, tool namespace `mcp__proliferate_workspace__<tool>`
([mcp/definition.rs](../../../anyharness/crates/anyharness-lib/src/domains/agent_operations/mcp/definition.rs)).
Exactly 20 tools ([mcp/tools.rs](../../../anyharness/crates/anyharness-lib/src/domains/agent_operations/mcp/tools.rs)):
`whoami`, `list_workspaces`, `list_workspace_options`, `list_agents`,
`get_agent`, `list_subagents`, `list_agent_launch_options`,
`list_agent_config_options`, `get_task_output`, `create_workspace`,
`pin_workspace`, `unpin_workspace`, `create_agent`, `configure_agent`,
`resume_agent`, `send_message`, `interrupt_agent`, `close_subagent`,
`open_subagent`, `promote_subagent`. Served over HTTP by
[product_mcp.rs](../../../anyharness/crates/anyharness-lib/src/api/http/product_mcp.rs)
with a capability token scoped to runtime × workspace × session × MCP
([mcp/auth.rs](../../../anyharness/crates/anyharness-lib/src/domains/agent_operations/mcp/auth.rs)).

**HTTP for humans/clients** ([subagents.rs](../../../anyharness/crates/anyharness-lib/src/api/http/subagents.rs)):
`GET /v1/workspaces/{id}/subagents` (roster), `GET /v1/sessions/{parent}/subagents`,
`POST /v1/sessions/{parent}/subagents/{child}/close|open|promote`. Wire shapes:
[subagents.rs](../../../anyharness/crates/anyharness-contract/src/v1/subagents.rs).

**In-process**: `AgentOperations` ([runtime/mod.rs](../../../anyharness/crates/anyharness-lib/src/domains/agent_operations/runtime/mod.rs))
is the single application boundary both adapters enter; it is built from
ports ([runtime/ports.rs](../../../anyharness/crates/anyharness-lib/src/domains/agent_operations/runtime/ports.rs))
that sessions, workspaces, harnesses and terminals implement, so this system
never touches a sibling's store.

## 4. Consumes

- `sessions` — session create/prompt/config/close through `AgentSessionMutations`;
  `SessionMutationAdmission` for the shared relationship gate; the
  `SessionExtension` hook for the turn-finished nudge
  ([hooks.rs](../../../anyharness/crates/anyharness-lib/src/domains/sessions/subagents/hooks.rs)).
- `workspaces` — `WorkspaceOperationGate` leases, workspace creation/pinning
  through `AgentWorkspaceOperations`; see [workspaces.md](../workspaces/README.md).
- `harnesses` — catalog and launch-option reads for `create_agent` /
  `configure_agent` (`AgentCatalogReads`, `AgentLaunchOptionReads`); see
  [harnesses.md](../harnesses/README.md).
- `terminals` — `get_task_output` reads command-run output
  (`AgentTaskOutputReads`).
- `integrations/mcp` — JSON-RPC, tool formatting, capability tokens (protocol
  mechanics, not product behavior).

## 5. Laws

**A child is a normal session; the relationship is the authority.**
`session_links(relation=subagent)` is the authorization check for every
relationship-targeting operation, and the child session plus capped
relationship insert atomically so an in-progress creation is never observable
as an ordinary session ([service.rs](../../../anyharness/crates/anyharness-lib/src/domains/sessions/subagents/service.rs)).

**Authority is resolved per call, never at token mint.** Every `tools/call`
re-resolves caller role, parent ownership, relationship, workspace and target
truth ([runtime/authorization_policy.rs](../../../anyharness/crates/anyharness-lib/src/domains/agent_operations/runtime/authorization_policy.rs));
a committed promotion changes authority for the next call without a new
identity. This is the runtime instance of Law 5 (identity once, capability per
call).

**Delegated agents cannot delegate.** A child receives Workspace for identity,
reads, messaging and parent-authorized operations, but `create_agent` is denied
by role ([runtime/subagent_lifecycle.rs](../../../anyharness/crates/anyharness-lib/src/domains/agent_operations/runtime/subagent_lifecycle.rs)).
Fan-out depth is one; tree-shaped work is tier two (spawned runs).

**Eight children per parent, Closed included.** The cap is enforced in the
same transaction as the insert; Closed relationships count so a parent cannot
churn through unbounded children.

**Close purges prompts, keeps everything else.** Close sets
`subagent_closed_at`, purges durable pending prompts, then non-terminally
unloads the actor; transcript, config, native session id and row survive.
Open restarts the same conversation; failure leaves it Closed and purged
prompts are not replayed. Promotion is allowed only while Open and deletes only
the relationship.

**Completion wake is durable admission, exactly once.** Terminal persistence
captures the child completion and delivery intent in the same transaction as
the event batch; the delivery worker admits at most one parent prompt with
`PromptProvenance::SubagentWake` per child, coalescing a still-queued wake in
place and suppressing a redundant one when the child's own message already
reached the parent — with a durable removal intent persisted as exactly one
`pending_prompt_removed` ([delivery/runtime.rs](../../../anyharness/crates/anyharness-lib/src/domains/sessions/subagents/delivery/runtime.rs)).
Restart and mobility preserve exactly-once visibility.

**Attachment is structural.** Workspace attaches iff
`workspace.surface == Standard && session.mcp_binding_policy != InternalOnly`;
selection happens before actor start and never consults the legacy
`subagents_enabled` flag ([product_catalog.rs](../../../anyharness/crates/anyharness-lib/src/domains/sessions/mcp_bindings/product_catalog.rs)).

## 6. Emits

- `subagent_turn_completed` — one parent-transcript event per
  Pending → Enqueued delivery transition (or per suppression), carrying the
  completion metadata the transcript indexes for wake receipts and roster
  invalidation.
- `pending_prompt_added` / `pending_prompt_removed` on the parent's queue
  (sessions' event vocabulary; this system is the producer for wake prompts).
- Telemetry: `anyharness.subagent.delivery_suppressed` (with reason).
- Roster view models (`WorkspaceSubagentRoster`, `SubagentLifecycleView` in
  [subagents.rs](../../../anyharness/crates/anyharness-lib/src/domains/agent_operations/subagents.rs))
  consumed by the client Agents pane and the activity feed.

## 7. Fences

| Not owned | Owner |
| --- | --- |
| Session engine, event log, prompt queue mechanics, link graph storage | sessions ([session-engine.md](../sessions/session-engine.md)) |
| Spawning a new run in a new environment; run results; cancel-tree | runs / api (control plane, greenfield) |
| Per-subagent model credentials | agent_auth — the runtime applies the selection the parent chose |
| MCP protocol scaffolding, capability-token crypto | runtime `mcp-scaffolding` capability ([integrations/mcp](../../../anyharness/crates/anyharness-lib/src/integrations/mcp/mod.rs)) |
| Cowork delegation (`domains/cowork/delegation`), cowork threads and roots | cowork — pending the decision below |
| Client Agents pane, tab strip, composer popover | client chat/workspace surfaces ([delegated-work.md](delegated-work.md)) |

Declared edges: `agent_operations → agents, sessions, workspaces` and
`sessions → agent_operations` (the extension/port direction). Zero grandfathered
store-reach sites — this domain already obeys AH-FENCE-002 by construction.

> [!decision] PABLO DECIDES: cowork → two-tier orchestration. Cowork
> (`domains/cowork`, 5K lines; managed workspaces, threads, delegation,
> `session_link_wake_schedules`) is a second delegation model beside this one:
> it has its own MCP tools, its own wake schedule table, and the only remaining
> `workspaces → cowork` core-to-surface edge. Options: (a) fold cowork
> delegation into subagents (one relationship model, one wake path) and keep
> cowork artifacts as [artifacts.md](../sessions/artifacts.md); (b) keep cowork as a
> separate product-surface domain. Recommendation: (a) — the two-tier ruling
> leaves no room for a third tier, and the wake-schedule table is exactly the
> kind of parallel mechanism the session engine doc forbids.

> [!decision] PABLO DECIDES: naming. The product MCP is `proliferate_workspace`
> and the folder is `agent_operations`; the system is `subagents`. Options: (a)
> rename the folder only (`systems/subagents/`), keep the MCP name (it is a
> wire contract agents have learned); (b) rename both. Recommendation: (a).

## 8. Code map

```text
anyharness/crates/anyharness-lib/src/domains/agent_operations/   → target: systems/subagents/
├── model.rs                     identities, roles, statuses, capability decisions
├── product_context.rs           per-turn product context, pin requests
├── subagents.rs                 roster/lifecycle view models
├── runtime/                     AgentOperations: authorization_policy, ordinary,
│   │                            subagent_lifecycle, subagent_roster, messaging,
│   │                            catalogs, workspaces, target_access, ports, error
└── mcp/                         the Workspace product MCP: definition, auth,
                                 context, tools, calls
anyharness/crates/anyharness-lib/src/domains/sessions/subagents/   session-owned mechanics
├── model.rs · service.rs        capped relationship insert, roster summaries
├── delivery/                    completion delivery worker (exactly-once wake)
├── hooks.rs                     SessionExtension: turn-finished nudge
└── transcript.rs                completion ↔ transcript correlation
anyharness/crates/anyharness-lib/src/api/http/{subagents,subagents_contract,
    subagents_errors,product_mcp}.rs                               transport
anyharness/crates/anyharness-lib/src/app/agent_operations.rs · app/product_mcp.rs   wiring
anyharness/crates/anyharness-contract/src/v1/{subagents,mcp}.rs
```

Client-plane presentation:
[components/workspace/delegated-work](../../../apps/packages/product-client/src/components/workspace/delegated-work),
[domain/chats/subagents](../../../apps/packages/product-client/src/domain/chats/subagents),
[components/playground/subagents-ux](../../../apps/packages/product-client/src/components/playground/subagents-ux).

## 9. Proof

- Tool contract and pins: [mcp/tests.rs](../../../anyharness/crates/anyharness-lib/src/domains/agent_operations/mcp/tests.rs),
  [tests/tool_contract.rs](../../../anyharness/crates/anyharness-lib/src/domains/agent_operations/mcp/tests/tool_contract.rs)
  (pins the exact 20-tool list), [tests/workspace_pins.rs](../../../anyharness/crates/anyharness-lib/src/domains/agent_operations/mcp/tests/workspace_pins.rs).
- Lifecycle and races: [runtime/subagent_lifecycle_tests.rs](../../../anyharness/crates/anyharness-lib/src/domains/agent_operations/runtime/subagent_lifecycle_tests.rs),
  [race_tests.rs](../../../anyharness/crates/anyharness-lib/src/domains/agent_operations/runtime/subagent_lifecycle_tests/race_tests.rs),
  [ordinary_tests.rs](../../../anyharness/crates/anyharness-lib/src/domains/agent_operations/runtime/ordinary_tests.rs),
  [messaging_tests.rs](../../../anyharness/crates/anyharness-lib/src/domains/agent_operations/runtime/messaging_tests.rs),
  [runtime/tests.rs](../../../anyharness/crates/anyharness-lib/src/domains/agent_operations/runtime/tests.rs),
  [error_tests.rs](../../../anyharness/crates/anyharness-lib/src/domains/agent_operations/runtime/error_tests.rs).
- Delivery exactly-once: [delivery/runtime/tests.rs](../../../anyharness/crates/anyharness-lib/src/domains/sessions/subagents/delivery/runtime/tests.rs).
- Intent: the `Agents` pane acceptance in
  [delegated-work.md](delegated-work.md).

## Known gaps / follow-ups

- Per-subagent harness/model selection is expressed through `create_agent`
  arguments today; the agent_auth selection primitive the two-tier ruling
  assumes ("per-subagent auth via selections") is not yet a first-class input.
- `subagents_enabled` remains serialized on session records for wire and
  mobility compatibility only.
