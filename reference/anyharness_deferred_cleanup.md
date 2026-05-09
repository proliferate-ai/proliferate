# AnyHarness Deferred Cleanup Inventory

Status: current cleanup inventory after the completed AnyHarness structural
migration phases and Phase 10a repo-shape rails.

Use this with `reference/anyharness_cleanup_migration_sequence.md`.
That file tracks the migration phases. This file separates:

- non-deferred closeout needed before calling the structural migration fully
  settled
- explicitly deferred architecture work
- file-size debt that should be burned down in focused follow-up PRs

Do not treat every item here as one migration wave. The point is to prevent
future agents from mixing narrow finalization work with deeper redesigns.

## Non-Deferred Closeout

These are the remaining structural cleanup items that should happen before we
call the non-deferred AnyHarness migration complete.

### Boundary Allowlist Burn-Down

The AnyHarness boundary checker currently passes with three allowlisted rows.
Those rows are migration debt, not durable exceptions.

| Rule | Current path | Why it remains | Desired cleanup |
| --- | --- | --- | --- |
| `API_LIVE_RUNTIME_IMPORT` | `anyharness/crates/anyharness-lib/src/api/http/sessions.rs` | The sessions transport still imports a permission decision type from live ACP runtime code. | Move the transport-facing decision shape to a neutral owner or have runtime map it before API response construction. API should not import live runtime internals. |
| `SESSION_STORE_LIVE_IMPORT` | `anyharness/crates/anyharness-lib/src/sessions/store/events.rs` | Store event persistence still imports a live ACP sanitizer. | Move persisted event sanitization into session event/domain/store-owned normalization. Store code should not import live ACP runtime modules. |
| `SESSION_STORE_LIVE_IMPORT` | `anyharness/crates/anyharness-lib/src/sessions/store/notifications.rs` | Store notification persistence still imports a live ACP sanitizer. | Move raw notification sanitization into session event/domain/store-owned normalization. Store code should not import live ACP runtime modules. |

Acceptance:

- `python3 scripts/check_anyharness_boundaries.py` passes with fewer or no
  AnyHarness allowlist rows.
- Removed rows are deleted from
  `scripts/anyharness_boundaries_allowlist.txt` in the same PR.
- The fix is narrow. Do not combine it with actor loop changes or topology
  moves unless the exact type move requires it.

### Clean Verification Baseline

Before declaring the non-deferred migration settled, verify from a clean
worktree on current `main`:

```bash
python3 scripts/check_anyharness_old_paths.py
python3 scripts/check_anyharness_boundaries.py
python3 scripts/check_max_lines.py
git diff --check
```

Run targeted Rust tests for any touched crate/module. Use broader `cargo test`
only when the touched area is broad enough to justify the cost.

### Source-Of-Truth Cleanup

Keep `reference/anyharness_cleanup_migration_sequence.md` as the phase tracker.
Older AnyHarness reference files are historical planning artifacts unless the
current tracker links to them.

When Phase 9 or Phase 10 changes reality, update:

- `docs/anyharness/README.md`
- the relevant `docs/anyharness/guides/**` file
- this inventory
- `reference/anyharness_cleanup_migration_sequence.md`

## Explicitly Deferred Work

These items are intentionally not part of the non-deferred closeout. They need
dedicated specs, focused PRs, or product decisions.

### Phase 8: Session Actor Spec And Loop Rewrite

Current state:

- The actor loop remains in `acp/session_actor.rs`.
- Supporting live interaction pieces remain around ACP permission and MCP
  elicitation modules.
- This file is the largest AnyHarness file and is the highest-risk cleanup.

Do next:

- Write `docs/anyharness/specs/session-actor.md` before implementation.
- Specify the actor command loop, busy interval, prompt queue, notification
  draining, cancellation, and background-work invariants.
- Then split actor internals into focused live-session modules.

Do not do:

- Do not delegate a broad rewrite without the spec.
- Do not change transcript semantics, prompt queue behavior, or MCP elicitation
  behavior as part of a mechanical file split.

### Phase 9: Final Topology And Naming

This is mostly ownership/path clarity, but it is still high-churn import work.
It should land after the non-deferred boundary debts are understood.

Candidate moves:

- session domain paths to `domains/sessions/**`
- workspace domain paths to `domains/workspaces/**`
- repo-root ownership decision under workspace/domain topology
- terminal live runtime paths to `live/terminals/**`
- event sink path to `live/sessions/event_sink/**`
- live session manager/client/broker naming cleanup

Acceptance:

- The PR is mostly mechanical.
- Old paths are deleted, not re-exported.
- Public caller-facing types stay stable unless a focused rename is explicitly
  assigned.

### Behavior Or Schema Redesigns

These are real cleanup needs, but they are not structural migration closeout.

- Cross-domain delete/cascade redesign.
- Transcript event schema redesign.
- MCP elicitation interaction redesign.
- Public contract shape changes.
- Agent/provider behavior changes.
- Workspace materialization lifecycle redesign.
- Review/cowork product workflow behavior changes.
- Large `AppState` dependency graph redesign.

Each one needs a focused spec or proposal before implementation.

## File-Size Debt

The max-line allowlist is still large. That is intentional ratchet debt:
existing files may remain temporarily, but new growth should not hide inside
them.

Treat oversized files by category.

### Manual/Core

These should not be split until the related spec or topology work exists:

- `anyharness/crates/anyharness-lib/src/acp/session_actor.rs`
- live session manager/client/broker files that will move or rename in Phase 9

### Topology-Dependent

These are best cleaned up during or after Phase 9 because the final path is
part of the cleanup:

- terminal live runtime service files
- workspace domain service/runtime/store files
- remaining session domain service/prompt/live-config files

### Focused Domain Burndown

These should be assigned as independent domain cleanup lanes. They are not
blockers for closing the broad structural migration if docs and allowlists
accurately track them.

- agent catalog/install/readiness files
- reviews runtime/service/store files
- cowork runtime files
- mobility service files

### Transport And Contract Burndown

These need separate API/contract lanes because they touch wire behavior,
OpenAPI shape, or route test organization.

- large `api/http/**` handlers
- OpenAPI assembly
- API router tests
- contract event/session files

### Adapter Burndown

Oversized adapter files should split by local capability, not product domain.
Adapters may parse command output and perform local operations; they should not
grow product lifecycle policy.

## Future-Agent Rules

When assigning follow-up agents:

- Start from `docs/anyharness/README.md`, the relevant guide/spec, and this
  inventory.
- Give the agent exactly one category or boundary row.
- Require behavior preservation unless the task explicitly names a behavior
  change.
- Require allowlist removal when a violation count drops.
- Stop and report if the task reaches `SessionActor`, transcript schema,
  public contract shape, or product workflow behavior unexpectedly.
