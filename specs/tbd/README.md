# TBD Specs

Status: non-authoritative planning index.

Files in this folder are useful notes, migration plans, and draft spec packs.
They are not operating law until they are promoted into `specs/codebase/**` or
`specs/developing/**` with a clear owner and contract.

## Current Drafts

| Draft | Use |
| --- | --- |
| [anyharness-structure-alignment-swarms.md](anyharness-structure-alignment-swarms.md) | Planning notes for AnyHarness structure-alignment agent work. |
| [cloud-shared-sandbox-spec-pack.md](cloud-shared-sandbox-spec-pack.md) | Cloud/shared sandbox planning pack. |
| [cloud-worker-control-loop.md](cloud-worker-control-loop.md) | Cloud worker control-loop load-reduction planning. |
| [frontend-structure-alignment-migration.md](frontend-structure-alignment-migration.md) | Frontend structure-alignment migration notes. |
| [security.md](security.md) | Draft security notes. |
| [structure-alignment-coordinator-model.md](structure-alignment-coordinator-model.md) | Coordinator model for structure-alignment planning. |
| [support-debug-correlation.md](support-debug-correlation.md) | Support/debug correlation follow-up notes. |
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
