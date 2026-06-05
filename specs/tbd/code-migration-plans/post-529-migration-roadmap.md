# Post-529 Migration Roadmap

Status: non-authoritative implementation planning index.

This roadmap is for the work that remains after PR 529, the tight
Target = Sandbox slot-collapse/data-model foundation, merges to `main`.

PR 529 makes the system slot-free. It does not, by itself, fully realize the
worker README/architecture from PR 528. Tier A is required to finish that
specced worker model: the worker must be reshaped into its documented roles and
must move to the control long-poll / event-tail transport.

Do not start these plans from a branch that does not include PR 529. The plans
assume:

- live code no longer has `slot_generation`, slot fences, slot guards, or leased
  slot fields
- worker/server/SDK/frontend readiness code routes managed runtime identity by
  `target_id`
- the new target-sandbox Alembic head migration is present

## How To Use These Plans

Each plan is meant to be handed to a coordinator or high-reasoning agent in the
same style as the first migration slice:

1. Start from latest `main` after PR 529 merges.
2. Read `AGENTS.md`, `specs/README.md`, the relevant area docs, and the plan.
3. Create a dedicated branch/worktree for the track or lane.
4. Write or update a concrete implementation plan before coding.
5. Run a plan critique loop.
6. Implement in focused slices.
7. Run targeted verification.
8. Run implementation critique and fix-up before PR review.

Post-529 tracks are separate PR series from a stable `main`. Unlike the PR 529
replacement migration, they should stay independently green at each PR boundary;
do not import the "red between phases is expected" posture unless a specific
track plan explicitly creates and owns a temporary integration branch.

Use `specs/tbd/structure-alignment-coordinator-model.md` for any structure
alignment track that will be run with subagents.

## Tiers

| Tier | Plan | Why It Exists | Dependency |
| --- | --- | --- | --- |
| Prereq | Shared Redis/wake ownership decision | Decide whether the control-loop owns the pub/sub doorbell and worker-tier conforms, or whether the durable-job substrate owns shared Redis/wake infrastructure. | Before control-loop implementation and before durable-job implementation. |
| A | [tier-a-worker-structure-alignment.md](tier-a-worker-structure-alignment.md) | Make the Rust worker code shape match the PR 528 worker README/architecture. | PR 529 merged. Required to realize the specced worker model. |
| A | [tier-a-worker-control-loop-two-poll.md](tier-a-worker-control-loop-two-poll.md) | Implement the control long-poll / event-tail transport and stop idle per-endpoint polling. | PR 529 merged; shared Redis/wake decision recorded. Required to realize the specced worker model. |
| B | [tier-b-worker-tier-durable-jobs.md](tier-b-worker-tier-durable-jobs.md) | Move server background work from in-process loops/fire-and-forget tasks toward a durable Celery/RabbitMQ/redbeat job system. | PR 529 merged; shared Redis/wake decision recorded; needs full design ratification before broad implementation. |
| B | [tier-b-server-structural-hygiene.md](tier-b-server-structural-hygiene.md) | Split cloud/server god files after the identity migration removes old seams. | PR 529 merged. Run command/auth boundary extractions before Tier C behavior changes in those files. |
| B | [tier-b-frontend-structure-alignment.md](tier-b-frontend-structure-alignment.md) | Turn the frontend structure alignment draft into executable lanes. | Independent; can run after guardrails plan is accepted. |
| B | [tier-b-anyharness-structure-alignment.md](tier-b-anyharness-structure-alignment.md) | Turn the AnyHarness structure swarm draft into executable PR lanes. | Independent. |
| B | [tier-b-workspace-migration-git-durability.md](tier-b-workspace-migration-git-durability.md) | Harden local/cloud workspace move flows around dirty and unpublished Git state. | Independent, but should read Target = Sandbox command semantics after PR 529. |
| C | [tier-c-agent-auth-bifrost-billing.md](tier-c-agent-auth-bifrost-billing.md) | Implement non-identity feature follow-through in agent auth, Bifrost BYOK, managed credits, billing, and settings/admin IA. | PR 529 merged for target-scoped auth state. |
| C | [tier-c-support-security-ops-runbooks.md](tier-c-support-security-ops-runbooks.md) | Fill support, security, observability, and runbook gaps from the merged docs. | Independent; promote any runbook docs before treating them as review law. |
| Deferred | `cloud_target` / `cloud_sandbox` table merge | Optional physical table consolidation after the 1:1 target/sandbox model settles. | Deferred by `specs/codebase/primitives/sandbox-provisioning.md` decision 5; needs its own plan before coding. |

## Recommended Order

1. **Tier A: worker structure alignment.**
   This makes the code navigable by the roles in the worker docs and creates
   stable paths for the incoming control-loop behavior.
2. **Shared Redis/wake ownership mini-ratification.**
   Decide the doorbell owner, Redis namespace, pub/sub vs redbeat relationship,
   and task/wake boundary before the control-loop bakes in a Redis shape.
3. **Tier A: control-loop / two-poll transport.**
   This realizes the runtime transport model and reduces DB-backed idle polling.
4. **Worker-tier durable jobs design ratification.**
   Decide RabbitMQ/Celery/Redis/redbeat shape before broad implementation.
5. **Server structural hygiene.**
   Split remaining cloud/server god files once the runtime identity and worker
   control paths are clear. Prioritize command/auth boundary extraction before
   Tier C behavior changes that touch those same files.
6. **Tier C feature follow-through.**
   Agent auth/Bifrost/billing work should land after the relevant command/auth
   server hygiene boundaries exist. It may run in parallel only with hygiene
   slices that do not touch the same file family.
7. **Frontend, AnyHarness, workspace durability.**
   These can run independently when staffed, but each should be a separate PR
   series with its own guardrails and verification.

## Coordination Seams

- Worker control-loop and worker-tier jobs both touch Redis and wake delivery.
  Decide shared Redis ownership, pub/sub vs redbeat usage, and task/wake
  boundaries before implementing either surface.
- Agent-auth/Bifrost/billing feature follow-through touches command
  preconditions and worker materialization. Coordinate with worker structure and
  control-loop work so the same command surfaces are not redesigned twice.
- Server structural hygiene should not race major behavior changes in the same
  files. Prefer sequencing: first extract stable boundaries, then change
  behavior inside those boundaries.
- Frontend structure alignment should preserve behavior unless a feature plan
  explicitly owns the behavior change.

## Universal Plan Template

Every track plan should keep these sections:

```text
# <Track Name>

## Starting Baseline
## Docs To Read
## Intended End State
## Owned Files / Surfaces
## Out Of Scope
## Migration Slices
## Data / Contract Changes
## Backward Compatibility And Deletion Plan
## Verification
## Risks And Open Questions
## Critique Prompts
```

If a draft doc is still tentative, the first slice should be a clarify/promote
slice that turns the relevant part into executable operating law before code
changes start.
