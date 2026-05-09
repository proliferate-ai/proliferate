# AnyHarness Cleanup Migration Sequence

Status: current migration tracker after the completed AnyHarness cleanup
phases and the Phase 10a docs, ratchet, focused-test, and boundary-rails
passes.

Authoritative docs:

- `docs/anyharness/README.md`
- `docs/anyharness/guides/**`
- `docs/anyharness/specs/session-engine.md`
- `docs/anyharness/specs/mcp.md`

Deferred and closeout inventory:

- `reference/anyharness_deferred_cleanup.md`

This plan is behavior-preserving unless a phase explicitly says otherwise.
Completed phases document landed ownership and shape; remaining phases document
planned or manual cleanup only.

## Current Status

| Phase | Status | Reality |
| --- | --- | --- |
| 0 | Complete | Repo-shape rails and allowlist discipline are established, including CI-enforced AnyHarness boundary checks. |
| 1 | Complete | Local file/git/hosting/process capabilities are under `adapters/**`; shared MCP helpers are under `integrations/mcp/**`; provider CLI mechanics are under `integrations/agent_cli/**`. |
| 2 | Complete | Product-domain cleanup landed for the completed lanes. Agents, cowork, reviews, plans, and mobility live under `domains/**`. Core sessions, workspaces, repo roots, and terminals remain transitional until Phase 9. |
| 3 | Complete | Product MCP servers follow feature-owned `mcp_server/**` modules and use shared `integrations/mcp/**` helpers where common protocol/auth scaffolding has landed. |
| 4 | Complete | Session MCP binding models, crypto, contract mapping, summaries, ACP conversion, and launch assembly live under `sessions/mcp_bindings/**`. |
| 5 | Complete | `SessionStore` is split under `sessions/store/**`, while the public `SessionStore` type remains caller-facing. |
| 6 | Complete | `SessionRuntime` is split under `sessions/runtime/**`, while the public `SessionRuntime` type remains caller-facing. |
| 7 | Complete | `SessionEventSink` is split under `acp/event_sink/**`, while the final `live/sessions/event_sink/**` topology remains future work. |
| 8 | Deferred/manual | The `SessionActor` loop rewrite remains deferred until a dedicated actor spec exists. Current actor implementation stays in `acp/session_actor.rs`. |
| 9 | Remaining | Final topology/naming moves remain: live session manager/client/broker naming, `sessions/**` to `domains/sessions/**`, `workspaces/**` to `domains/workspaces/**`, terminal live topology, and related import cleanup. |
| 10 | Remaining | Further ratchet tightening, allowlist shrinkage, and additional tests remain after the implementation phases settle. |
| 10a | Complete | Docs describe completed Phases 1-7, old-path ratchets block retired split files, focused invariant tests landed, and boundary rails run in CI. Phase 8 actor work and Phase 9 final topology stay deferred/manual. |

Non-deferred closeout is intentionally narrow: burn down the remaining
AnyHarness boundary allowlist rows, keep repo-shape checks green from a clean
worktree, and update docs when reality changes. Large file-size burndown and
Phase 8/9 architecture work are tracked separately in
`reference/anyharness_deferred_cleanup.md`.

## North Star

Make AnyHarness readable by path.

When a developer sees a file path, they should know whether the file owns:

- transport
- durable product truth
- live runtime state
- local workspace/machine capability
- protocol/vendor mechanics
- app composition
- process startup

The migration goal is not to redesign the session engine during structural
passes. The goal is to expose existing ownership clearly enough that deeper
changes become safe.

## Global Rules For Every Phase

- Preserve public API unless the phase explicitly says otherwise.
- Prefer moving one symbol once over leaving old and new copies behind.
- Use direct imports. Do not add compatibility barrels.
- Split by responsibility, not by line count alone.
- Run targeted tests/checks for the touched crate/module when feasible.
- Keep `app/mod.rs`, route registration, and core session files single-owned
  during a PR.
- If a file is too complex to reason about safely, stop and mark it manual
  instead of doing a broad mechanical rewrite.

## Phase 1: Low-Risk Topology Moves

Status: complete.

Landed reality:

- local capability folders moved toward `adapters/**`:
  - files
  - git
  - hosting
  - processes
- generic protocol/vendor helpers moved toward `integrations/**`:
  - MCP JSON-RPC helpers
  - capability-token primitives
  - agent CLI executable/probe/launcher mechanics

Still true:

- Product tool behavior belongs in owning product domains.
- Core session behavior was intentionally not part of this phase.

## Phase 2: Product Domains In Parallel

Status: complete for the scoped lanes that landed.

Landed reality:

- `domains/agents/**`
- `domains/cowork/**`
- `domains/reviews/**`
- `domains/plans/**`
- `domains/mobility/**`

Still transitional:

- `sessions/**` remains the session-domain path until Phase 9.
- `workspaces/**` remains the workspace-domain path until Phase 9.
- `repo_roots/**` remains transitional until Phase 9 decides final ownership.

Do not treat Phase 2 completion as final topology completion.

## Phase 3: Product MCP Consolidation

Status: complete.

Landed reality:

- Shared MCP protocol/auth helpers live under `integrations/mcp/**`.
- Product MCP servers live with their product domains:
  - `domains/cowork/mcp_server/**`
  - `domains/reviews/mcp_server/**`
  - `sessions/subagents/mcp_server/**`
  - `sessions/workspace_naming/mcp_server/**`

Still true:

- Product tool behavior stays in product domains.
- HTTP endpoint wrappers may remain feature-local until a focused transport
  cleanup.
- MCP elicitation remains a live interaction concern, not product MCP server
  behavior.

## Phase 4: Session MCP Assembly

Status: complete.

Current implementation:

```text
sessions/mcp_bindings/
  model.rs
  crypto.rs
  contract.rs
  summaries.rs
  acp.rs
  assembly.rs
```

The assembly boundary owns:

- applying internal-only versus inherited user-binding policy
- decrypting user-supplied MCP bindings
- collecting launch extras from registered session extensions
- merging user and product MCP servers in launch order
- merging and validating binding summaries
- producing system prompt additions
- returning restart-required or missing-data-key errors when persisted
  bindings cannot be used

The final topology target keeps this ownership under
`domains/sessions/mcp_bindings/**`.

## Phase 5: Session Store Split

Status: complete.

Current implementation:

```text
sessions/store/
  mod.rs
  sessions.rs
  events.rs
  notifications.rs
  live_config.rs
  pending_prompts.rs
  attachments.rs
  background_work.rs
  links.rs
  tests/
```

The public type remains `SessionStore`. Callers should not depend on internal
store module boundaries.

Still deferred:

- Cross-domain deletion redesign.
- Schema-level cascade changes unless covered by a focused persistence task.

## Phase 6: Session Runtime Split

Status: complete.

Current implementation:

```text
sessions/runtime/
  mod.rs
  contract.rs
  creation.rs
  prompt.rs
  pending_prompts.rs
  config.rs
  fork.rs
  lifecycle.rs
  interactions.rs
  replay.rs
  plans.rs
  startup.rs
  tests.rs
```

Rules:

- Preserve `SessionRuntime` as the public type.
- Split by API-facing session operation family.
- Keep live bridging in runtime; stores/services should not call live actors.
- Do not combine this with the actor loop rewrite.

## Phase 7: Session Event Sink Split

Status: complete.

Current implementation:

```text
acp/event_sink/
  mod.rs
  state.rs
  publish.rs
  turns.rs
  assistant.rs
  reasoning.rs
  tools.rs
  plans.rs
  interactions.rs
  config.rs
  pending_prompts.rs
  runtime_events.rs
  metadata.rs
  background_work.rs
  lifecycle.rs
  normalization/
  tests/
```

The public actor-facing type remains `SessionEventSink`.

Still future:

- Moving the sink to `live/sessions/event_sink/**` belongs to Phase 9.
- Transcript schema redesign is out of scope.
- Plan entity ingestion should only move in a focused plan-ingestion pass.

## Phase 8: Session Actor Spec And Loop Rewrite

Status: deferred/manual.

Before implementation:

- Write `docs/anyharness/specs/session-actor.md`.
- Spell out loop invariants:
  - actor owns one live ACP-backed session.
  - actor owns the busy interval.
  - prompt loop remains responsive to commands, notifications, and background
    work.
  - durable pending prompt queue is drained without releasing busy between
    turns.
  - actor receives final MCP launch payload; it does not assemble product MCPs.

Current implementation remains:

```text
acp/session_actor.rs
```

Do not delegate this broadly until the spec exists.

## Phase 9: Naming And Final Topology

Status: remaining.

Candidate moves:

- `acp/manager` live-session manager ownership and naming.
- `acp/runtime_client` ACP client ownership and naming.
- `acp/permission_broker/**` to live session interactions.
- `sessions/**` to `domains/sessions/**`.
- `workspaces/**` to `domains/workspaces/**`.
- `terminals/**` to `live/terminals/**`.
- `acp/event_sink/**` to `live/sessions/event_sink/**`.

Acceptance:

- Rename PRs are mostly mechanical.
- Import churn is isolated.
- Old paths are deleted, not re-exported.

## Phase 10: Ratchet Tightening

Status: remaining.

Already landed through Phase 10a:

- Old-path ratchets block retired flat files for completed session/runtime
  splits from being reintroduced.
- Focused invariant tests cover session MCP assembly behavior and event-sink
  publish/normalization behavior.
- AnyHarness boundary rails run in CI with count-based allowlist discipline for
  current transitional debt.

Work:

- Shrink boundary allowlists beyond the current seeded counts.
- Shrink file-size allowlists.
- Add or strengthen tests around:
  - prompt input to ACP blocks
  - actor prompt queue invariants
  - product MCP endpoint compatibility
- Update docs when implementation differs from the initial target.

Acceptance:

- New target-shape code is CI-enforced.
- Remaining exceptions are documented with owner and reason.

Use `reference/anyharness_deferred_cleanup.md` to distinguish closeout work
from explicitly deferred actor, topology, schema, and product-behavior work.

## Phase 10a: Docs Reality Lane

Status: complete.

Landed reality:

- Authoritative docs and the migration reference now describe the current
  split runtime shape: session MCP bindings, session store, session runtime,
  and ACP event sink are split, while their public caller-facing types remain
  stable.
- The old-path ratchet is wired into the repo-shape CI lane for completed
  splits, so retired flat implementation files stay retired.
- Focused invariant coverage landed for session MCP assembly and event-sink
  behavior.
- AnyHarness boundary rails and the seeded allowlist landed in CI; new
  violations, increased counts, and stale allowlist rows fail the check.

Still deferred:

- `SessionActor` spec and loop rewrite.
- Final Phase 9 topology and naming moves.
- Further Phase 10 allowlist shrinkage and expanded focused coverage.

## Explicitly Leave For Later

Do not mix these into broad structural migration PRs:

- Full `SessionActor` loop rewrite before `session-actor.md` exists.
- Cross-domain delete/cascade redesign.
- Transcript event schema redesign.
- MCP elicitation interaction redesign.
- Public contract shape changes.
- Agent/provider behavior changes.
- Workspace materialization lifecycle redesign.
- Review/cowork product workflow behavior changes.
- Large `AppState` dependency graph redesign.
- Renaming core live/session types before code ownership is split.

The detailed deferred inventory, including current boundary rows and file-size
debt categories, lives in `reference/anyharness_deferred_cleanup.md`.

## Handoff Template

```text
Read:
- docs/anyharness/README.md
- the relevant docs/anyharness/guides/*.md
- docs/anyharness/specs/session-engine.md or specs/mcp.md if applicable
- reference/anyharness_cleanup_migration_sequence.md

Task:
Implement Phase <N>, lane <lane name>.

Rules:
- Preserve behavior.
- Do not touch core session files unless assigned.
- Do not add compatibility barrels.
- Delete old paths when moved.
- Keep public APIs stable unless explicitly assigned.

Output:
- List changed files.
- Explain ownership changes.
- List tests/checks run.
- Call out skipped/manual follow-up.
```
