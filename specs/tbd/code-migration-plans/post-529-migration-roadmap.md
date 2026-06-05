# Post-529 Migration Roadmap

Status: non-authoritative implementation planning index.

This roadmap is for the work that remains after PR 529, the tight
Target = Sandbox slot-collapse/data-model foundation, merges to `main`.

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

Use `specs/tbd/structure-alignment-coordinator-model.md` for any structure
alignment track that will be run with subagents.

## Tiers

| Tier | Plan | Why It Exists | Dependency |
| --- | --- | --- | --- |
| A | [tier-a-worker-structure-alignment.md](tier-a-worker-structure-alignment.md) | Make the Rust worker code shape match the PR 528 worker README/architecture. | PR 529 merged. |
| A | [tier-a-worker-control-loop-two-poll.md](tier-a-worker-control-loop-two-poll.md) | Implement the control long-poll / event-tail transport and stop idle per-endpoint polling. | PR 529 merged; coordinate Redis decisions with worker-tier plan. |
| B | [tier-b-worker-tier-durable-jobs.md](tier-b-worker-tier-durable-jobs.md) | Move server background work from in-process loops/fire-and-forget tasks toward a durable Celery/RabbitMQ/redbeat job system. | PR 529 merged; needs design ratification before broad implementation. |
| B | [tier-b-server-structural-hygiene.md](tier-b-server-structural-hygiene.md) | Split cloud/server god files after the identity migration removes old seams. | PR 529 merged. |
| B | [tier-b-frontend-structure-alignment.md](tier-b-frontend-structure-alignment.md) | Turn the frontend structure alignment draft into executable lanes. | Independent; can run after guardrails plan is accepted. |
| B | [tier-b-anyharness-structure-alignment.md](tier-b-anyharness-structure-alignment.md) | Turn the AnyHarness structure swarm draft into executable PR lanes. | Independent. |
| B | [tier-b-workspace-migration-git-durability.md](tier-b-workspace-migration-git-durability.md) | Harden local/cloud workspace move flows around dirty and unpublished Git state. | Independent, but should read Target = Sandbox command semantics after PR 529. |
| C | [tier-c-agent-auth-bifrost-billing.md](tier-c-agent-auth-bifrost-billing.md) | Implement non-identity feature follow-through in agent auth, Bifrost BYOK, managed credits, billing, and settings/admin IA. | PR 529 merged for target-scoped auth state. |
| C | [tier-c-support-security-ops-runbooks.md](tier-c-support-security-ops-runbooks.md) | Fill support, security, observability, and runbook gaps from the merged docs. | Independent; promote any runbook docs before treating them as review law. |

## Recommended Order

1. **Tier A: worker structure alignment.**
   This makes the code navigable by the roles in the worker docs.
2. **Tier A: control-loop / two-poll transport.**
   This realizes the runtime transport model and reduces DB-backed idle polling.
3. **Worker-tier durable jobs design ratification.**
   Decide RabbitMQ/Celery/Redis/redbeat shape before broad implementation.
4. **Server structural hygiene.**
   Split remaining cloud/server god files once the runtime identity and worker
   control paths are clear.
5. **Tier C feature follow-through.**
   Agent auth/Bifrost/billing work can proceed in parallel with server hygiene
   when ownership boundaries are clear.
6. **Frontend, AnyHarness, workspace durability.**
   These can run independently when staffed, but each should be a separate PR
   series with its own guardrails and verification.

## Coordination Seams

- Worker control-loop and worker-tier jobs both touch Redis and wake delivery.
  Decide shared Redis ownership, pub/sub vs redbeat usage, and task/wake
  boundaries before implementing both in parallel.
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
