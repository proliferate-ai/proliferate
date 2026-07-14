# TBD Specs

Status: non-authoritative planning index.

Files in this folder are useful notes, plans, and draft spec packs.
They are not operating law until they are promoted into `specs/codebase/**` or
`specs/developing/**` with a clear owner and contract.

## Current Drafts

| Draft | Use |
| --- | --- |
| [agents-catalog-registry-migration.md](agents-catalog-registry-migration.md) | Finalized migration plan for the agents catalog/registry stack: version-pinned reconcile, catalog v2 consumption, auth-context classification, PR-0..8. |
| [anyharness-self-update-v1.md](anyharness-self-update-v1.md) | Mechanism design for worker-owned in-place AnyHarness binary self-update in cloud sandboxes, the `PROLIFERATE_ANYHARNESS_VERSION` export, and the catalog-vs-binary-vs-registry convergence-track restatement + T4 contract. |
| [anyharness-grammar-adoption-backlog.md](anyharness-grammar-adoption-backlog.md) | Audit backlog for adopting the AnyHarness domain grammar (guides/mental-model.md): 144 findings in recommended wave order. |
| [anyharness-structure-alignment-swarms.md](anyharness-structure-alignment-swarms.md) | Planning notes for AnyHarness structure-alignment agent work. |
| [cloud-worker-control-loop.md](cloud-worker-control-loop.md) | Cloud worker control-loop load-reduction planning. |
| [frontend-structure-alignment-migration.md](frontend-structure-alignment-migration.md) | Frontend structure-alignment notes. |
| [support-system-alignment.md](support-system-alignment.md) | Historical live-system audit and superseded planning record. See the [accepted support-system contract](../codebase/features/support-system.md). |
| [support-system-end-to-end-handoff.md](support-system-end-to-end-handoff.md) | Execution-grade worktree, implementation, AWS cutover, canary, rollback, and definition-of-done handoff for the accepted support-system contract. |
| [structure-alignment-coordinator-model.md](structure-alignment-coordinator-model.md) | Coordinator model for structure-alignment planning. |
| [web-desktop-unification-migration.md](web-desktop-unification-migration.md) | Non-authoritative rollout history and execution detail for the Web/Desktop product-client unification. The promoted contract is [web-desktop-client-unification.md](../codebase/features/web-desktop-client-unification.md); the binding execution/freeze ledger is [web-desktop-unification-rollout.md](../developing/deploying/web-desktop-unification-rollout.md). |
| [web-desktop-unification-intake-ledger.md](web-desktop-unification-intake-ledger.md) | Historical 2026-07-13 intake snapshot of open PRs, worktrees, and migration conflicts. Current phase and slice state lives in the [rollout ledger](../developing/deploying/web-desktop-unification-rollout.md); this file is historical sweep input only. |
| [workspace-migration-git-durability-plan.md](workspace-migration-git-durability-plan.md) | Workspace migration git durability planning. |

## Promotion Rules

Before moving a draft out of `tbd/`:

- decide whether the owner is a structure, primitive, feature, or developer
  process doc
- rewrite tentative planning language as current operating law
- link the promoted doc from the owning category README
- remove or archive any duplicate draft content left behind
- update [../README.md](../README.md) only when the top-level read map changes

Do not cite a `tbd/` document as the source of truth for code review or release
readiness. If a task depends on a draft, promote the relevant contract first or
name the draft as non-authoritative context.
