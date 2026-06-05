# Tier B: Frontend Structure Alignment

Status: executable coordinator wrapper around the existing frontend draft.

## Starting Baseline

This track is independent of PR 529, but future cloud/frontend work should read
the post-529 target identity model. Start from latest `main` and keep each PR
behavior-preserving unless its lane explicitly owns a behavior change.

## Docs To Read

- `AGENTS.md`
- `specs/README.md`
- `specs/codebase/structures/frontend/README.md`
- Relevant frontend focused guide:
  - `guides/components.md`
  - `guides/hooks.md`
  - `guides/state.md`
  - `guides/lib.md`
  - `guides/config.md`
  - `guides/copy.md`
  - `guides/access.md`
  - `guides/styling.md`
  - `packages/README.md`
- Feature specs for touched product surfaces
- `specs/tbd/frontend-structure-alignment-migration.md`
- `specs/tbd/structure-alignment-coordinator-model.md`

## Intended End State

Frontend code follows the documented layer/folder model:

- Components render UI and delegate behavior to hooks.
- Product hooks live under documented responsibility folders.
- Pure product rules live in `lib/domain/**` or product-domain packages.
- Multi-step workflows live in `lib/workflows/**` or workflow hooks with explicit
  dependencies.
- Raw external access stays behind access hooks/platform boundaries.
- Shared packages obey dependency direction.
- UI primitives live in `apps/packages/ui/**` where applicable.

## Owned Files / Surfaces

- `apps/desktop/src/**`
- `apps/web/src/**`
- `apps/mobile/src/**` when explicitly in a lane
- `apps/packages/**`
- Structure report/check scripts

## Out Of Scope

- Product redesign.
- Broad UI restyling.
- Backend/API behavior changes except where a frontend lane needs generated type
  updates from an already-merged API change.

## Migration Slices

Use the existing draft workstreams as the source of truth:

1. Guardrails and inventory.
2. Low-risk structure fixes.
3. UI primitive consolidation.
4. Hook folder normalization.
5. Page and component boundary cleanup.
6. Workflow and store lifecycle boundary cleanup.
7. Large surface decomposition.
8. Shared package shape normalization.
9. Guardrail enforcement after exceptions are small and owned.

Each workstream should have its own branch and PR.

## Data / Contract Changes

None expected. Generated SDK updates should come only from API changes owned by
other PRs.

## Backward Compatibility And Deletion Plan

Preserve behavior. Delete old paths after moves. Exceptions must list path,
rule, owner/workstream, reason, and resolution owner.

## Verification

- `pnpm --filter proliferate exec tsc --noEmit --pretty false`
- Targeted vitest suites for moved logic
- Frontend structure report/check commands introduced by guardrails
- Package builds for touched shared packages

## Risks And Open Questions

- Guardrails should start report-only.
- Large-file decomposition can hide behavior changes. Keep PRs narrow.
- Raw DOM control replacement can become UI churn; use primitives carefully and
  preserve appearance.

## Critique Prompts

Plan critique:

```text
Review the frontend structure alignment plan. Does it follow the frontend docs,
preserve behavior, keep lanes narrow, and name exceptions correctly? Return
findings first.
```

Implementation critique:

```text
Review the frontend alignment diff. Look for component-owned workflows, hooks in
wrong folders, raw access in product UI, package boundary violations, UI churn,
and missing type/tests. Return findings first.
```
