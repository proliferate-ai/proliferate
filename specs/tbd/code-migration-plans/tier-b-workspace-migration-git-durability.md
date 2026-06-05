# Tier B: Workspace Migration Git Durability

Status: feature/durability migration plan. The existing draft records prior
implementation status and critique; refresh it before new code work.

## Starting Baseline

This track is independent of PR 529 but should read post-529 cloud command and
target identity semantics before touching cloud mobility/start paths.

## Docs To Read

- `AGENTS.md`
- `specs/README.md`
- `specs/codebase/features/workspace-migration.md`
- `specs/codebase/features/cloud-dispatch.md`
- `specs/codebase/primitives/cloud-commands.md`
- `specs/codebase/structures/frontend/README.md`
- relevant frontend guides for touched UI/hooks/lib/state/access
- `specs/codebase/structures/anyharness/README.md`
- relevant AnyHarness guides for mobility/Git/workspaces
- `specs/codebase/structures/server/README.md`
- `specs/tbd/workspace-migration-git-durability-plan.md`

## Intended End State

Workspace moves between local and cloud should not lose or smuggle code changes:

- dirty source state is detected and handled before move
- clean but unpublished/ahead branches can offer push-and-move
- dirty branches use an explicit prepare-branch flow with editable commit
  message and include-unstaged control
- preflight reruns immediately before confirm/move
- AnyHarness export can require clean Git state and expected commit/branch
- destination prep validates branch, commit, worktree cleanliness, sessions, and
  terminals
- cloud startup honors requested base SHA instead of reusing an incompatible
  materialized workspace

## Owned Files / Surfaces

- Desktop workspace migration UI/hooks/lib
- AnyHarness mobility contract and mobility domain/service
- AnyHarness Git adapter operations when needed
- Server cloud workspace start/ensure paths for requested revision handling
- Tests across frontend, AnyHarness, and server mobility/cloud startup

## Out Of Scope

- Snapshot/fork/stash as default migration behavior.
- Broad redesign of workspace UI.
- Target = Sandbox identity changes already owned by PR 529.

## Migration Slices

1. **Refresh baseline**
   - Confirm which prior branch/status items from the draft already merged.
   - Update the draft or create a fresh implementation plan from current `main`.
2. **AnyHarness preflight/export guards**
   - Rich Git status in preflight.
   - Export request guards for expected branch/commit and clean state.
3. **Desktop branch-prep workflow**
   - Extract reusable commit/push prep from publish flow.
   - Add migration-specific copy and state handling.
4. **Destination prep hardening**
   - Fetch/validate requested branch/SHA.
   - Refuse unsafe branch/worktree reuse.
5. **Server cloud requested-revision handling**
   - Ensure cloud start/requeue respects requested base SHA.
6. **End-to-end confirmation**
   - Re-run preflight before move and auto-continue after successful prep.

## Data / Contract Changes

Likely changes:

- AnyHarness mobility contract request/response fields for Git status and export
  guards
- SDK/frontend generated types if AnyHarness/cloud contracts change
- Possible server request fields for requested base SHA or revision checks

## Backward Compatibility And Deletion Plan

Gate stricter behavior behind explicit mobility flow fields if old clients still
exist. Remove old dirty-delta assumptions from the product move flow once strict
guards are in place.

## Verification

- AnyHarness Rust tests for Git preflight/export/destination prep
- Desktop vitest/typecheck for migration workflow
- Server tests for requested revision cloud start
- Manual or automated local-to-cloud and cloud-to-local smoke with dirty,
  unpublished, ahead, detached, conflicted, and clean states

## Risks And Open Questions

- Need to distinguish low-level archive capabilities from product move policy.
- Remote selection must not assume `origin`.
- Destination branch safety is high risk; avoid destructive branch movement.

## Critique Prompts

Plan critique:

```text
Review the workspace migration git durability plan. Does it prevent dirty or
wrong-commit moves without relying on snapshots/stashes? Are AnyHarness,
desktop, and server responsibilities separated correctly? Return findings first.
```

Implementation critique:

```text
Review the workspace migration durability diff. Look for stale preflight trust,
unsafe Git operations, wrong remote assumptions, dirty delta smuggling,
component-owned workflows, and missing end-to-end cases. Return findings first.
```
