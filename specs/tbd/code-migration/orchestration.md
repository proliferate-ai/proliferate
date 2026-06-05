# Target = Sandbox Code Migration Orchestration

Working document for the post-spec code migration. This is meant to be read by
one coordinating high-reasoning agent after the collapsed-identity specs merge
to `main`. The coordinator should use this document to spin up distinct
high-reasoning implementation agents in fresh worktrees, one bounded phase at a
time, with critique loops before and after implementation.

This document is non-authoritative. The source of truth remains the merged
repo specs. If this file conflicts with the specs, the specs win.

Path convention:

- Source copy while preparing: `/Users/pablohansen/delete/target-sandbox-code-migration-orchestration.md`
- Required in-repo copy on the integration branch:
  `specs/tbd/code-migration/orchestration.md`
- Phase prompts should tell fresh worktree agents to read the in-repo copy when
  it exists. The `~/delete` copy is for the human/coordinator before Phase 0.

## Critical Execution Framing

This migration is a **single replacement PR implemented through internal
phases**, not a chain of independently-green PRs.

The reason is mechanical: once the shared schema and wire spine stop exposing
slot fields, unmigrated consumers will fail until their phase lands. That is
expected. The integration branch may be red between Phase 1 and Phase 3.

Therefore:

- The integration branch is the one replacement PR.
- Phase branches are work units that squash into the integration branch.
- Phase merge gates mean "phase-specific critique and targeted verification are
  clean", not "the whole repository is green."
- Full green verification is required at Phase 3, after cutover and deletion.
- Do not attempt an additive fallback migration with old and new slot-aware
  paths. The merged specs deliberately choose a replacement migration because
  the managed-cloud model has no production users to preserve.

## Relationship To The Broader Alignment Program

PR 528, `docs(product): consolidate architecture and worker specs`, merged a
broader documentation set than this migration implements. This document is the
complete, executable plan for the foundational **Target = Sandbox** track only.
It should not be read as the implementation plan for every draft alignment doc
that landed with PR 528.

Positioning:

- "Align with the collapsed-identity spec updates" means this document and this
  migration. The end-state specs for Target = Sandbox are authoritative and this
  track is first because other managed-cloud work builds on the simplified
  identity model.
- "Align the whole codebase with every new or draft spec" is a larger program.
  Several tracks remain independent or intentionally later.

| Track | What It Is | Spec Maturity | Relationship | Order |
| --- | --- | --- | --- | --- |
| 1. Target = Sandbox | Core cloud/worker identity and data model. | End-state specs are merged; this document is the executable code plan. | Foundation for managed cloud, worker identity, commands, and runtime access. | First. |
| 2. Worker-tier / Celery substrate | Move background jobs such as wake, provision, and reconcile to Celery/RabbitMQ/redbeat. | Drafts: `worker-tier-scalability-rfc.md`, `worker-tier-migration-catalog.md`. | Orthogonal substrate that should wrap the jobs after Target = Sandbox is stable. | After Track 1. |
| 3. Server structural hygiene | Split large server files such as cloud worker services into ownership-correct modules. | Audit/draft level, not an end-state implementation spec. | Track 1 only does minimal splits needed to remove slot paths and unblock validation. | After Track 1. |
| 4. Frontend structure alignment | Align frontend code to the folder/layer standards. | Draft: `frontend-structure-alignment-migration.md`. | Independent; frontend structure was a model for the worker docs but is not implemented here. | Parallel or independent. |
| 5. AnyHarness structure alignment | Reshape AnyHarness runtime crates/modules toward their structure docs. | Draft: `anyharness-structure-alignment-swarms.md`. | Independent of this managed-cloud identity migration. | Parallel or independent. |
| 6. Misc feature tracks | Examples include workspace migration/git durability. | Drafts such as `workspace-migration-git-durability-plan.md`. | Independent feature or hardening tracks. | As needed. |
| Deferred cleanup | Merge or further collapse `cloud_target` / `cloud_sandbox` tables if desired. | Mentioned as future cleanup in the collapsed model discussion. | Cleanup after Track 1, not required for this migration to satisfy Target = Sandbox behavior. | Later. |

## The Invariant Card

Every phase agent and every critique agent must receive this card verbatim.

```text
Collapsed identity is the target model.

- Stable product/config identity: sandbox_profile.
- Runtime identity: cloud_target == managed sandbox == worker runtime.
- A managed target is 1:1 with its provider sandbox and is ephemeral.
- target_id is both identity and epoch.
- Replacing a sandbox archives/retires the old target and creates a new target.
- There is no slot layer.
- There is no slot_generation.
- There is no SlotFence.
- There is no slot_guard.
- There are no leased_cloud_sandbox_id / leased_slot_generation fields.
- A stale worker holds an archived target_id; nothing routes to it.
- Worker enrollment, heartbeat, command lease/result/delivery, and event ingest
  correlate by worker_token -> target_id.
- Cloud creates cloud_workspace rows before worker materialization.
- Worker results never auto-create cloud_workspace rows.
- cloud_workspace materialization validity is materialized_target_id == active
  primary target_id for the profile.
- Down traffic has two classes:
  - commands: discrete acts, at-least-once, idempotent
  - reconcile: desired steady-state by revision map
- Worker runtime shape:
  - one control long-poll down: commands + revision signals
  - one event tail up: AnyHarness events -> Cloud projection
  - heartbeat is liveness/update, not a work poll
```

## Coordinator Responsibilities

The coordinator owns sequencing, branch hygiene, review loops, and integration.
It should not personally implement large chunks unless taking a phase itself.

Coordinator duties:

- Start from latest `main` after the specs PR has merged.
- Create one integration branch, for example:
  `codex/target-sandbox-code-migration`.
- Copy this orchestration material into the integration branch before spawning
  phase worktrees, or paste the full invariant + phase prompt into every
  subagent. Do not assume every fresh worktree/subagent can read `~/delete`.
  Recommended in-repo location for the integration branch:
  `specs/tbd/code-migration/orchestration.md`.
- For each phase, create a fresh worktree and phase branch from the correct
  integration commit.
- Give each phase agent:
  - the invariant card
  - the in-repo orchestration doc copied from this document
  - the specific phase prompt
  - the exact docs to read
  - the assigned path boundaries
- Require a plan file before implementation.
- Send that plan file to a critique agent.
- Require the implementation agent to update the plan from critique before
  coding.
- After implementation, send the diff to one or more critique agents.
- Require the implementation agent to iterate until critique is clean.
- Squash-merge completed phase branches into the integration branch only after
  the phase-specific critique loop and targeted verification are complete.
- Track whether the integration branch is temporarily red. This is allowed
  between Phase 1 and Phase 3 when shared replacement work is incomplete.
- Run targeted integration checks after shared-contract merges, but do not
  expect the full suite to pass until Phase 3.
- Never merge a phase that leaves duplicate old/new paths unless the phase plan
  explicitly proves the old path is isolated and removed by Phase 3.

Recommended branch names:

```text
codex/target-sandbox-phase-0-coordinator
codex/target-sandbox-phase-1-schema-wire
codex/target-sandbox-phase-2a-runtime-target
codex/target-sandbox-phase-2b-commands-workspaces
codex/target-sandbox-phase-2c-agent-auth-billing
codex/target-sandbox-phase-2d-worker
codex/target-sandbox-phase-2e-events-control
codex/target-sandbox-phase-2f-consumers
codex/target-sandbox-phase-3-cutover
```

Recommended plan file paths:

```text
specs/tbd/code-migration-plans/phase-0-coordinator.md
specs/tbd/code-migration-plans/phase-1-schema-wire.md
specs/tbd/code-migration-plans/phase-2a-runtime-target.md
specs/tbd/code-migration-plans/phase-2b-commands-workspaces.md
specs/tbd/code-migration-plans/phase-2c-agent-auth-billing.md
specs/tbd/code-migration-plans/phase-2d-worker.md
specs/tbd/code-migration-plans/phase-2e-events-control.md
specs/tbd/code-migration-plans/phase-2f-consumers.md
specs/tbd/code-migration-plans/phase-3-cutover.md
```

## Universal Phase Workflow

Use this process for every implementation phase.

1. Create a fresh worktree and phase branch.
2. Read `AGENTS.md`, `specs/README.md`, and the phase-specific docs.
3. Inspect the assigned code paths with `rg` and focused file reads.
4. Write the phase plan file in `specs/tbd/code-migration-plans/`.
5. Stop and hand the plan to a critique agent.
6. The critique agent reviews only the plan and leaves concrete findings.
7. The implementation agent updates the plan until critique is clean.
8. The implementation agent implements the phase end to end.
9. Run phase-specific automated checks.
10. Send the implementation diff to critique agents.
11. Iterate until implementation critique is clean.
12. Squash-merge the phase branch into the integration branch.
13. Coordinator runs targeted integration checks required before starting
    dependent phases.

Plan file required sections:

```text
# Phase <id>: <name>

## Docs Read
## Code Survey
## Intended Behavior
## Files / Modules Owned
## Files / Modules Explicitly Out Of Scope
## Data / Contract Changes
## Implementation Steps
## Backward Compatibility And Deletion Plan
## Tests And Verification
## Risks / Open Questions
## Critique Responses
```

Implementation completion summary required sections:

```text
## Summary
## Files Changed
## Behavior Changed
## Dead Paths Deleted
## Verification Run
## Remaining Follow-Ups
## Final Grep Results
```

## Universal Critique Prompt

Use this prompt for plan critique and adapt the file path.

```text
You are a high-reasoning critique agent. Review the plan file at:
<PLAN_FILE>

Read the invariant card in `specs/tbd/code-migration/orchestration.md` if it
exists; otherwise read
`/Users/pablohansen/delete/target-sandbox-code-migration-orchestration.md`.
Also read the phase-specific docs referenced by the plan. Do not implement.

Review for:
- Does the plan follow the merged specs?
- Does it preserve the Target = Sandbox invariant?
- Does it accidentally retain slots, slot_generation, SlotFence, slot_guard, or
  leased slot fields?
- Are ownership boundaries correct per AGENTS.md and area specs?
- Are generated-code boundaries handled by generation, not hand edits?
- Are old and new paths prevented from coexisting past this phase?
- Are tests sufficient for the blast radius?
- Are merge dependencies and parallelism risks called out?
- Are rollback/cutover/deletion details explicit?

Return findings first, ordered by severity, with file/section references to the
plan. If there are no blocking findings, say so clearly and list residual risk.
```

Use this prompt for implementation critique and adapt the branch/worktree.

```text
You are a high-reasoning implementation critique agent. Review the current
phase branch/worktree:
<WORKTREE>

Read:
- AGENTS.md
- specs/README.md
- specs/tbd/code-migration/orchestration.md if present, otherwise
  /Users/pablohansen/delete/target-sandbox-code-migration-orchestration.md
- the phase plan file
- all phase-specific specs referenced by the plan

Do not implement unless explicitly asked. Review the diff for:
- correctness against the Target = Sandbox invariant
- stale slot/fence/runtime-environment paths
- missing generated-code regeneration
- broken server/worker contract alignment
- missing tests for acceptance criteria
- duplicate old/new behavior paths
- boundary violations
- security or auth regressions
- passive UI / wake behavior regressions when relevant

Return findings first, ordered by severity, with concrete file/line references.
If clean, say the phase is review-clean and name remaining test gaps or risk.
```

## Global Verification Gates

Run these before the final integration branch is considered done. Earlier
phases should run targeted subsets and may leave unrelated failures caused by
not-yet-merged phases. Phase summaries must distinguish expected integration
redness from new regressions.

```bash
cd server
uv run pytest -q
```

```bash
cargo test -p anyharness-contract
cargo test -p proliferate-worker
cargo test -p proliferate-supervisor
```

```bash
scripts/check_server_boundaries.py
scripts/check_max_lines.py
```

Final code grep should have no live hits except historical migrations or
explicitly justified diagnostics:

```bash
rg "slot_generation|SlotFence|slot_guard|leased_slot|leased_cloud_sandbox|slot_fence|slot-fence" server anyharness/crates/proliferate-worker
```

Managed-cloud code should no longer rely on runtime-environment access paths:

```bash
rg "CloudRuntimeEnvironment|runtime_environment_id|active_sandbox_id|materialized_slot_generation" server/proliferate
```

Every remaining hit must be classified in the Phase 3 plan as one of:

- historical Alembic migration kept intentionally
- non-managed compatibility path
- support/diagnostic read-only field pending deletion
- dead code to delete before merge

## Phase Dependency Graph

```text
Phase 0 Coordinator package
  -> Phase 1 Schema + Wire Spine (server + Rust wire; integration may go red)
       -> Phase 2A Runtime/Profile/Target
       -> Phase 2C Agent Auth/Billing/Gateway
       -> Phase 2D Proliferate Worker
       -> Phase 2E Events/Exposure/Control
       -> Phase 2B Commands/Workspaces/Wake
            -> Phase 2F Consumers
                 -> Phase 3 Integration/Cutover (full green gate)
```

Parallelism:

- Phase 0 and Phase 1 are sequential gates.
- After Phase 1, Phase 2A, 2B, 2C, 2D, and 2E may be **planned** in parallel.
- Implementation can run in parallel only for non-overlapping path clusters.
  Chokepoint files below require coordinator locks and sequenced merges.
- Phase 2B can be planned in parallel but should merge after the runtime/profile
  helpers it consumes are stable.
- Phase 2F should wait until 2A and 2B expose stable launch/command behavior.
- Phase 3 is sequential and last.

## Shared Chokepoint Files

These files are known collision points. They must have one active owner at a
time. Other phases coordinate through helpers, follow-up patches, or the
coordinator.

| File / Cluster | Chokepoint Owner | Notes |
| --- | --- | --- |
| `server/proliferate/server/cloud/worker/service.py` | Phase 2E after Phase 1 mechanical slot removal | Touches enrollment, heartbeat, command result/delivery, materialization, inventory, events, projections, exposures. Other phases should expose helpers and avoid direct edits unless coordinated. |
| `server/proliferate/db/store/cloud_sync/commands.py` | Phase 2B after Phase 1 model/dataclass removal | Command lease/result/delivery and workspace materialization state live here. Phase 1 may do mechanical schema/dataclass removal first. |
| `server/proliferate/server/cloud/runtime/provision.py` | Phase 2A | Runtime provisioning also touches auth/slot identity today. Phase 2C should provide auth helpers rather than independently editing this file. |
| `server/proliferate/server/cloud/commands/service.py` | Phase 2B | Runtime-config and agent-auth preflight call sites converge here. Phase 2C owns auth helper APIs, not command orchestration. |
| `anyharness/crates/proliferate-worker/src/cloud_client/*.rs`, `identity/**`, worker store identity rows | Phase 1 for wire/identity fields, Phase 2D for runtime structure | Phase 1 freezes both sides of the wire. Phase 2D may then reshape folders/loops without changing the contract again. |

Every phase plan must list whether it touches a chokepoint. If it does, the
plan must name the owner, the intended merge order, and any temporary expected
redness.

## Phase 0: Coordinator Package

Type: sequential, planning only.

Goal: prepare the integration branch and working instructions so every later
agent executes the same process and the same invariant.

Docs to read:

- `AGENTS.md`
- `specs/README.md`
- `specs/codebase/primitives/sandbox-provisioning.md`
- `specs/codebase/primitives/cloud-commands.md`
- `specs/tbd/cloud-worker-protocol-design.md`
- `specs/tbd/runtime-worker-supervisor-design.md`
- this document

Code to survey:

- `server/proliferate/db/models/cloud/**`
- `server/proliferate/db/store/cloud_sync/**`
- `server/proliferate/server/cloud/worker/**`
- `server/proliferate/server/cloud/runtime/**`
- `anyharness/crates/proliferate-worker/src/**`

Deliverables:

- integration branch from latest `main`
- in-repo copy of this orchestration doc at
  `specs/tbd/code-migration/orchestration.md`, or an equivalent checked-in
  prompt pack, so all worktree agents can read it
- baseline grep report pasted into the phase plan
- final phase list and branch names confirmed
- chokepoint ownership table copied into the phase plan and adjusted from the
  actual code survey
- no code behavior changes

Prompt:

```text
You are the coordinator for the Target = Sandbox code migration.

Start from latest main after the collapsed-identity specs have merged. Create
or identify the integration branch. Read AGENTS.md, specs/README.md, and
/Users/pablohansen/delete/target-sandbox-code-migration-orchestration.md.

Write specs/tbd/code-migration-plans/phase-0-coordinator.md. Include:
- exact integration branch name
- whether the orchestration doc was copied into the integration branch and where
- baseline grep report for slot/fence/runtime-environment leftovers
- phase order and parallelism
- shared chokepoint files and their owners
- worktree/branch naming
- verification commands
- reviewer/critique prompts to use

Do not implement runtime behavior in Phase 0.
```

Acceptance:

- Coordinator can hand this doc and the Phase 0 plan to later agents without
  additional oral context.
- Baseline grep proves where old concepts still exist.

## Phase 1: Schema + Wire Spine

Type: sequential gate.

Goal: freeze the shared data and wire shape so later agents build to one
contract. This phase updates **both** sides of worker/cloud wire types. The
integration branch may be red after this phase because downstream services have
not yet been migrated.

Primary specs:

- `specs/codebase/primitives/sandbox-provisioning.md`
- `specs/codebase/primitives/cloud-commands.md`
- `specs/codebase/primitives/agent-auth.md`
- `specs/codebase/structures/server/README.md`
- `specs/codebase/structures/server/guides/database.md`
- `specs/codebase/structures/server/guides/workers.md`
- `specs/codebase/structures/sdk/README.md`

Owned paths:

- `server/proliferate/db/models/cloud/**`
- `server/proliferate/db/store/cloud_sync/**`
- `server/proliferate/db/store/cloud_sandboxes.py`
- `server/proliferate/db/store/cloud_sandbox_profiles.py`
- `server/proliferate/db/store/cloud_workspaces.py`
- `server/proliferate/db/store/cloud_agent_auth/**`
- `server/alembic/versions/**`
- `server/proliferate/server/cloud/worker/models.py`
- `server/proliferate/server/cloud/worker/service.py` only for mechanical wire
  field removal and model construction required by the new DTOs
- `anyharness/crates/proliferate-worker/src/cloud_client/mod.rs`
- `anyharness/crates/proliferate-worker/src/cloud_client/commands.rs`
- `anyharness/crates/proliferate-worker/src/cloud_client/heartbeat.rs`
- `anyharness/crates/proliferate-worker/src/identity/credentials.rs`
- `anyharness/crates/proliferate-worker/src/identity/enrollment.rs`
- `anyharness/crates/proliferate-worker/src/store/mod.rs` for identity and
  pending-result schema field removal only
- generated SDK/contract files only through owning generation commands

Out of scope:

- full runtime provisioning behavior
- full command wake behavior
- frontend/mobile UI
- broad worker folder reshaping beyond DTO and local identity compatibility
- worker control/tail/lifecycle behavior beyond keeping the new wire compileable

Core work:

- remove slot fields from managed-cloud ORM models and dataclasses
- remove `leased_cloud_sandbox_id` and `leased_slot_generation`
- remove worker/enrollment `cloud_sandbox_id` and `slot_generation`
- remove worker Rust wire/local identity `cloud_sandbox_id` and
  `slot_generation` at the same time as server DTOs
- make `cloud_sandbox` 1:1 with `target_id`
- make `cloud_target_runtime_access` per target with no active sandbox fence
- make `sandbox_profile_target_state` the broadened per `(profile, target)` row
- replace `materialized_slot_generation` with `materialized_target_id`
- ensure server and Rust worker route/request/response models carry
  `cloud_workspace_id` and `sandbox_profile_id`, no slot fields
- add/adjust Alembic migrations and migration tests
- regenerate any required SDK/contract outputs

Prompt:

```text
Implement Phase 1: Schema + Wire Spine for the Target = Sandbox migration.

Read:
- AGENTS.md
- specs/README.md
- specs/codebase/structures/server/README.md
- specs/codebase/structures/server/guides/database.md
- specs/codebase/structures/server/guides/workers.md
- specs/codebase/structures/sdk/README.md
- specs/codebase/primitives/sandbox-provisioning.md
- specs/codebase/primitives/cloud-commands.md
- specs/codebase/primitives/agent-auth.md
- specs/tbd/code-migration/orchestration.md

First write specs/tbd/code-migration-plans/phase-1-schema-wire.md and stop.
After plan critique is clean, implement only this phase.

Do not keep compatibility slot fields in live code. Update both server and Rust
worker wire structs in this phase. Do not hand-edit generated SDK output. Do not
implement provisioning, wake, or UI behavior except where required to keep the
shared contract compiling.
```

Verification:

- targeted migration/model/store tests
- `cd server && uv run pytest -q <targeted tests>`
- SDK/contract regeneration diff clean
- grep for slot/fence fields in owned model/store/server-wire/Rust-wire paths

Expected integration state:

- Full server/worker test suites may fail after this phase because services
  outside the spine still reference removed fields. The phase summary must list
  expected failures and the later phase responsible for each.

Merge gate:

- Later phases can compile against this branch without inventing their own
  compatibility contract.

## Phase 2A: Cloud Runtime, Profile, And Target Lifecycle

Type: parallel after Phase 1, merge before Phase 2B if shared helpers are needed.

Goal: implement the server-side lifecycle for profiles, ephemeral primary
targets, background provisioning, runtime access writes, and target replacement.

Primary specs:

- `specs/codebase/primitives/sandbox-provisioning.md`
- `specs/codebase/primitives/billing.md`
- `specs/codebase/structures/server/README.md`
- `specs/codebase/structures/server/guides/domains.md`
- `specs/codebase/structures/server/guides/integrations.md`
- `specs/developing/local/dev-profiles.md` if launch/profile behavior changes

Owned paths:

- `server/proliferate/server/cloud/runtime/**`
- `server/proliferate/db/store/cloud_sandbox_profiles.py`
- `server/proliferate/db/store/cloud_sandboxes.py`
- `server/proliferate/db/store/cloud_sync/targets.py`
- `server/proliferate/server/cloud/compute/**` when billing policy hooks are
  needed
- provider integration call sites needed for E2B create/resume/kill

Core work:

- `ensure_personal_sandbox_profile`
- `ensure_organization_sandbox_profile`
- idempotent primary target creation for a profile
- enrollment token carries `(sandbox_profile_id, target_id)`
- `provision_managed_target` background flow
- `replace_managed_target` archives old target+sandbox and creates a new target
- `cloud_target_runtime_access` populated from enrollment/heartbeat
- runtime status/profile target state composed for API reads
- no E2B call in synchronous profile ensure path

Prompt:

```text
Implement Phase 2A: Cloud Runtime/Profile/Target lifecycle.

Read the invariant card and all Phase 2A specs in the in-repo orchestration doc
created by Phase 0.

First write specs/tbd/code-migration-plans/phase-2a-runtime-target.md and stop.
After critique is clean, implement end to end.

Stay within cloud runtime/profile/target lifecycle. Do not implement command
wake or workspace launch except for narrow helper contracts consumed by later
phases. Do not reintroduce slot guards or target reuse across sandbox
replacement.
```

Verification:

- profile ensure tests, including concurrency
- organization profile ensure tests
- target replacement tests
- provisioning failure/retry tests
- runtime access write tests
- no E2B call from synchronous ensure tests

## Phase 2B: Commands, Workspaces, And Wake

Type: parallel planning after Phase 1, merge after Phase 2A helper contracts.

Goal: align command enqueue/lease/result/delivery and managed workspace launch
with target correlation, `cloud_workspace_id`, async wake, and passive UI.

Primary specs:

- `specs/codebase/primitives/cloud-commands.md`
- `specs/codebase/primitives/sandbox-provisioning.md`
- `specs/codebase/primitives/workspace-provisioning.md`
- `specs/codebase/primitives/workspace-lifecycle.md`
- `specs/codebase/features/pending-workspace-shell.md`
- `specs/codebase/structures/server/README.md`

Owned paths:

- `server/proliferate/server/cloud/commands/**`
- `server/proliferate/server/cloud/workspaces/**`
- `server/proliferate/db/store/cloud_sync/commands.py`
- `server/proliferate/db/store/cloud_workspaces.py`
- `server/proliferate/server/cloud/runtime/wake.py`
- passive read endpoints that must not wake
- automation caller touch points only where needed to use the shared launch path

Core work:

- `cloud_commands.cloud_workspace_id` on managed-cloud commands
- target-correlated lease/result/delivery with archived-target inert behavior
- worker result rejects unknown/missing `cloud_workspace_id`
- managed `cloud_workspace` row exists before AnyHarness materialization
- `materialized_target_id` validity
- `_validate_runtime_config_preflight`
- async wake job and explicit wake endpoint
- wake-required kinds fail with typed `failed_delivery` errors when blocked
- passive UI read paths never call wake or runtime access
- remove `slot_guard` imports/calls from command/workspace-owned call sites;
  Phase 3 only deletes the orphaned module after every owner has removed calls

Prompt:

```text
Implement Phase 2B: Commands, Workspaces, And Wake.

Read the invariant card and all Phase 2B specs in the in-repo orchestration doc
created by Phase 0.

First write specs/tbd/code-migration-plans/phase-2b-commands-workspaces.md and
stop. After critique is clean, implement end to end.

Do not touch agent-auth internals except through the published preflight/state
API. Do not create Cloud workspaces from worker results. Do not make enqueue
block on E2B. Do not wake in passive read endpoints.
```

Verification:

- command target correlation tests
- archived target result rejected/inert tests
- cloud workspace id correlation tests
- runtime config preflight tests
- async wake tests
- passive UI does-not-wake tests
- automation launch uses managed-profile launch test

## Phase 2C: Agent Auth, Gateway, And Billing Rebind

Type: parallel after Phase 1.

Goal: remove slot fences from auth/gateway/billing runtime readiness and bind
validity to `(sandbox_profile, target)`.

Primary specs:

- `specs/codebase/primitives/agent-auth.md`
- `specs/codebase/primitives/agent-auth-bifrost-byok.md`
- `specs/codebase/primitives/billing.md`
- `specs/codebase/primitives/sandbox-provisioning.md`
- `specs/codebase/structures/server/README.md`
- `specs/codebase/structures/server/guides/auth.md`

Owned paths:

- `server/proliferate/server/cloud/agent_auth/**`
- `server/proliferate/db/store/cloud_agent_auth/**`
- `server/proliferate/db/models/cloud/agent_auth*.py`
- `server/proliferate/server/billing/**`
- `server/proliferate/db/store/billing.py`

Core work:

- agent-auth target state loads by `(profile, target)`
- remove active sandbox/slot generation validity checks
- runtime grants and gateway materialization scoped to target/sandbox without
  slot generation
- `refresh_agent_auth_config` preflight uses `sandbox_profile_target_state`
- billing counts active managed sandboxes/targets without joining through
  `CloudRuntimeEnvironment`
- wake billing hook is ready for Phase 2B to call
- remove `slot_guard` imports/calls from agent-auth/billing-owned call sites;
  Phase 3 only deletes the orphaned module

Prompt:

```text
Implement Phase 2C: Agent Auth, Gateway, And Billing Rebind.

Read the invariant card and all Phase 2C specs in the in-repo orchestration doc
created by Phase 0.

First write specs/tbd/code-migration-plans/phase-2c-agent-auth-billing.md and
stop. After critique is clean, implement end to end.

Do not preserve slot generation as an auth freshness dimension. The target is
the epoch. Do not broaden billing behavior beyond the spec; preserve existing
credit/quota semantics while changing the runtime identity joins.
```

Verification:

- agent auth refresh against new target state
- stale target/auth result inert tests
- gateway grant/materialization tests
- billing active sandbox/target count tests
- wake billing hook unit tests

## Phase 2D: Proliferate Worker

Type: parallel after Phase 1.

Goal: make the Rust worker consume the new target/profile identity, remove slot
fields, echo workspace ids, and move to the two-poll structure.

Primary specs:

- `specs/codebase/structures/proliferate-worker/README.md`
- `specs/codebase/structures/proliferate-worker/architecture.md`
- `specs/codebase/structures/proliferate-worker/guides/control.md`
- `specs/codebase/structures/proliferate-worker/guides/tail.md`
- `specs/codebase/structures/proliferate-worker/guides/lifecycle.md`
- `specs/codebase/structures/proliferate-worker/guides/materialization.md`
- `specs/tbd/cloud-worker-protocol-design.md`
- `specs/tbd/runtime-worker-supervisor-design.md`
- `install/README.md` only if installer/service layout changes

Owned paths:

- `anyharness/crates/proliferate-worker/src/**`
- generated worker client/types through owning generation flow
- `anyharness/crates/proliferate-supervisor/**` only if the mailbox contract
  must change; otherwise leave supervisor alone

Core work:

- build on Phase 1's wire/identity removal; do not re-add `cloud_sandbox_id` or
  `slot_generation`
- persist `target_id`, `sandbox_profile_id`, worker token
- command result echoes `cloud_workspace_id` and `anyharness_workspace_id`
- dispatcher synthesizes `AgentAuthExternalScope`
- expected runtime config revision attached for scoped commands
- reshape current folders to target ownership:
  - `commands/` -> `control/commands/`
  - `sync/tailer.rs` and `sync/backfill.rs` -> `tail/`
  - `sync/revoked_jti.rs` -> `control/reconcile/handlers/revoked_jti.rs`
    or the equivalent reconcile-domain handler once Phase 2E server support is
    ready
  - `updates/` -> `lifecycle/`
  - `materialization/` remains target-local effects called by control handlers
  - `cloud_client/control.rs` remains transport under `cloud_client/`
- fold revoked-JTI into control reconcile when Phase 2E server support is ready
- heartbeat writes supervisor desired-update mailbox; supervisor remains owner
  of applying updates

Prompt:

```text
Implement Phase 2D: Proliferate Worker.

Read the invariant card and all Phase 2D specs in the in-repo orchestration doc
created by Phase 0.

First write specs/tbd/code-migration-plans/phase-2d-worker.md and stop. After
critique is clean, implement end to end.

Do not keep slot fields in local SQLite as compatibility state unless the plan
proves they are historical-only and unreachable. The worker is already partly
reshaped, so the plan must include a current-to-target folder map and state how
aggressive the move is in this phase. Do not make the worker wake itself. Do not
move supervisor responsibilities into the worker.
```

Verification:

- `cargo test -p proliferate-worker`
- identity/enrollment tests
- command result echo tests
- pending result replay tests
- no slot grep in worker src except historical migration comments if justified

## Phase 2E: Events, Exposure, And Control Reconcile

Type: parallel after Phase 1.

Goal: finish the cloud/worker protocol shape: control wait carries commands and
revision/exposure signals; event tail is exposure-gated; revoked-JTI becomes a
reconcile domain.

Primary specs:

- `specs/tbd/cloud-worker-protocol-design.md`
- `specs/codebase/primitives/cloud-commands.md`
- `specs/codebase/primitives/claiming.md`
- `specs/codebase/structures/server/README.md`
- `specs/codebase/structures/proliferate-worker/README.md`

Owned paths:

- `server/proliferate/server/cloud/worker/control/**`
- `server/proliferate/server/cloud/worker/api.py`
- `server/proliferate/server/cloud/worker/service.py`
- `server/proliferate/db/store/cloud_sync/worker_control.py`
- `server/proliferate/db/store/cloud_sync/worker_exposures.py`
- `server/proliferate/server/cloud/events/**`
- `server/proliferate/server/cloud/live/**`
- worker control/tail client paths if not owned by Phase 2D, coordinated
  through the integration branch

Core work:

- one control long-poll returns commands and revision signals
- revision map includes revoked-JTI
- separate `/revoked-jtis` poll retired or made compatibility-only until Phase 3
- exposure snapshots drive worker projection cursor
- event ingest discards inactive exposure events with ack
- live fanout remains post-commit
- control transport never builds domain bundles itself
- remove `slot_guard` imports/calls from worker transport/event-owned call
  sites; Phase 3 only deletes the orphaned module

Prompt:

```text
Implement Phase 2E: Events, Exposure, And Control Reconcile.

Read the invariant card and all Phase 2E specs in the in-repo orchestration doc
created by Phase 0.

First write specs/tbd/code-migration-plans/phase-2e-events-control.md and stop.
After critique is clean, implement end to end.

Keep cloud/worker as transport. Domain bundle logic stays in the owning domain.
Do not reintroduce a third worker poll for revoked-JTI. Do not make event ingest
authoritative over exposure policy. In the plan, explicitly classify each
cloud/worker/control path as "existing to migrate" or "new to build" based on
the current code survey.
```

Verification:

- worker control wait tests
- exposure cursor tests
- inactive exposure event ack/drop tests
- live publish after commit tests
- revoked-JTI revision/bundle tests

## Phase 2F: Consumers And Product Callers

Type: after Phase 2A and 2B stable.

Goal: move all product callers to the shared managed-profile launch and command
shape so no feature keeps a legacy runtime-environment or partial-provisioning
path.

Primary specs:

- `specs/codebase/features/automations.md`
- `specs/codebase/features/cloud-dispatch.md`
- `specs/codebase/features/mobile-cloud-client.md`
- `specs/codebase/features/web-cloud-local-parity.md`
- `specs/codebase/features/pending-workspace-shell.md`
- `specs/codebase/primitives/workspace-provisioning.md`
- `specs/codebase/primitives/cloud-commands.md`
- frontend docs if UI surfaces change

Owned paths:

- `server/proliferate/server/automations/**`
- `server/proliferate/server/cloud/slack/**` if active producers exist
- `apps/web/src/**` only for API contract fallout
- `apps/mobile/src/**` only for API contract fallout
- `apps/desktop/src/**` only for API contract fallout
- `cloud/sdk-react/**` and SDK clients through generation/owning flow

Core work:

- automations use the same managed-profile launch helper or fail before
  partial rows
- web/mobile/desktop callers pass and consume new command/workspace fields
- no caller reads raw runtime URL/token from workspace
- pending shell handles queued wake and typed failed-delivery states
- UI surfaces target/profile readiness without waking passive views

Prompt:

```text
Implement Phase 2F: Consumers And Product Callers.

Read the invariant card and all Phase 2F specs in the in-repo orchestration doc
created by Phase 0.

First write specs/tbd/code-migration-plans/phase-2f-consumers.md and stop.
After critique is clean, implement end to end.

Do not invent feature-specific managed-cloud launch flows. Use the shared
server helpers from Phase 2A/2B. Keep frontend changes minimal and contract-
driven; do not redesign UI unless required by the new states.
```

Verification:

- automation launch tests
- command status/error UI tests where changed
- SDK build/generation checks
- targeted frontend tests for changed hooks/components

## Phase 3: Integration, Cutover, And Dead Path Deletion

Type: sequential, last.

Goal: remove old model leftovers, reconcile phase seams, run final verification,
and prepare the integration branch for review/merge.

Primary specs:

- every spec referenced above
- `specs/spec-catalog.md`
- `specs/codebase/structures/server/README.md`
- `specs/codebase/structures/proliferate-worker/README.md`
- `specs/developing/deploying/ci-cd.md`

Owned paths:

- all touched paths as needed for integration fixes
- deletion of old compatibility modules
- support diagnostics and runbook updates if field names changed

Core work:

- delete `server/proliferate/server/cloud/worker/slot_guard.py` only after
  Phase 2 owners have removed their own imports/calls
- delete or isolate `CloudRuntimeEnvironment` managed-cloud paths
- remove old worker revoked-JTI poll if superseded
- remove slot fields from worker SQLite migrations or classify historical-only
- remove duplicate old/new managed workspace creation paths
- update support diagnostics to new target/profile names
- run full grep classification
- run full automated verification
- write final merge summary

Prompt:

```text
Implement Phase 3: Integration, Cutover, And Dead Path Deletion.

Read every phase plan and the invariant card in the in-repo orchestration doc
created by Phase 0.

First write specs/tbd/code-migration-plans/phase-3-cutover.md and stop. After
critique is clean, implement end to end.

This is the deletion and integration phase. Do not defer live slot/fence paths
past this phase. Every remaining old-model grep hit must be deleted or
explicitly classified as historical migration / non-managed / diagnostic.
```

Verification:

- full server tests
- full relevant Rust tests
- server boundary and max-line checks
- final grep classification
- manual smoke checklist from specs 00 and 04 if local full-stack setup is
  feasible

## Final Main-Agent Prompt

This is the prompt to give the one main orchestration agent.

```text
You are the coordinator for the post-spec Target = Sandbox code migration.

Read:
- AGENTS.md
- specs/README.md
- /Users/pablohansen/delete/target-sandbox-code-migration-orchestration.md

Your job is to execute the orchestration document. Create one integration
branch from latest main after the specs PR has merged. For each phase, create a
fresh worktree and spin up high-reasoning implementation agents as needed.

For every phase:
1. Give the phase agent the invariant card and phase prompt.
2. Require a plan file before implementation.
3. Spin up a high-reasoning critique agent to review the plan.
4. Make the phase agent revise until the plan is clean.
5. Let the phase agent implement end to end.
6. Spin up one or more high-reasoning critique agents to review the
   implementation diff.
7. Make the phase agent iterate until implementation review is clean.
8. Squash-merge the phase branch into the integration branch.
9. Run targeted integration checks before dependent phases.

Parallelize only where the dependency graph permits. Keep the integration
branch coherent. Do not merge any phase that reintroduces or preserves live slot
identity, slot_generation, SlotFence, slot_guard, leased slot fields, or managed
CloudRuntimeEnvironment paths.

Finish only when Phase 3 is clean, full verification has run or failures are
clearly reported, and the final merge summary is ready.
```
