# Frontend Structure Alignment

Status: alignment planning note. This document is not a canonical frontend
standard. The canonical rules remain in `specs/codebase/structures/frontend/README.md`,
the focused guides under `specs/codebase/structures/frontend/guides/`, and
`specs/codebase/structures/frontend/packages/README.md`.

Purpose: coordinate focused PRs that align the existing frontend code with the
current frontend structure docs. This is not a docs cleanup project. If a
subagent finds an ambiguous or missing rule, it should propose the smallest
doc clarification needed to make the code alignment unambiguous.

## Operating Model

- Run each workstream in its own worktree and branch.
- Use `codex/frontend-<workstream>` branch names unless the PR owner chooses a
  clearer scoped name.
- Every workstream starts by reading:
  - `specs/README.md`
  - `specs/codebase/structures/frontend/README.md`
  - the focused frontend guide for the layer being changed
  - `specs/codebase/structures/frontend/packages/README.md` when touching shared packages
  - feature specs under `specs/codebase/features/**` when touching a covered product
    surface
- Every PR states the specific docs and rules it aligns with.
- Preserve behavior and UI unless an explicit behavior change is part of the
  alignment.
- Prefer narrow PRs with one structure boundary fixed at a time.
- Do not create new abstractions just to move code. Extract only when the new
  owner is clearer under the frontend docs.
- When a workstream cannot remove a violation safely, leave a named exception
  with the canonical owner and resolution path.
- The guardrails workstream should merge early in report-only mode so all
  later workstreams can reduce the same inventory.

## Alignment Policy Decisions

- The existing frontend structure docs are clear enough to start. This
  alignment is primarily code alignment with those docs, not a prerequisite doc
  rewrite.
- Exceptions are allowed only when a workstream cannot remove a violation
  safely in its PR, and they must be rare. Each exception must name the path,
  rule, owning workstream, reason, and resolution owner.
- Guardrails start in report-only mode and move to enforcement only after the
  remaining exception list is small, intentional, and owned.
- Product hook folders should move to the existing documented responsibility
  folders by default. Do not preserve special folders such as `tabs`,
  `selection`, `mobility`, `subagents`, or similar names unless a PR proves the
  canonical folders cannot express the responsibility cleanly and updates the
  docs accordingly.
- DOM controls should use `apps/packages/ui/**` primitives. Avoid adding raw DOM
  control exceptions; if a primitive variant is missing, extend the primitive
  API first.
- Shared package surface naming should be consistent and direct, but it should
  not block higher-risk behavior-preserving alignment work. Normalize package
  paths as the owning package workstream touches them.
- `lib/workflows/**` should use explicit dependency objects even when that
  requires companion hook changes. Hooks gather React, store, access,
  navigation, toast, cache, and telemetry capabilities; workflows receive them.
- Large-file thresholds guide priority rather than forcing mechanical splits.
  Split mixed-ownership files first. A pure large file requires a named reason
  and owner before it is excluded from a split.

## PR Series

- Guardrails and inventory.
- Low-risk structure fixes.
- UI primitive consolidation.
- Hook folder normalization.
- Page and component boundary cleanup.
- Workflow and store lifecycle boundary cleanup.
- Large surface decomposition.
- Shared package shape normalization.
- Guardrail enforcement after the exception list is small and owned.

## Workstreams

### `frontend-guardrails`

- Status: ready to staff.
- Canonical docs:
  - `specs/codebase/structures/frontend/README.md`
  - `specs/codebase/structures/frontend/guides/components.md`
  - `specs/codebase/structures/frontend/guides/hooks.md`
  - `specs/codebase/structures/frontend/guides/lib.md`
  - `specs/codebase/structures/frontend/guides/state.md`
  - `specs/codebase/structures/frontend/packages/README.md`
- Goal:
  - Create a repeatable report for frontend structure drift.
  - Start in report-only mode so it can merge before the migration is complete.
- Scope:
  - Raw DOM controls outside `apps/packages/ui/**`.
  - Primitive definitions outside `apps/packages/ui/**`.
  - `.ts` files under `components/**`.
  - Product hooks directly under `hooks/<domain>/`.
  - Nonstandard product hook responsibility folders.
  - Forbidden package imports across `product-domain`, `product-ui`,
    `product-surfaces`, `ui`, and `design`.
  - Large frontend files over the documented thresholds.
- Report command:
  - `python3 scripts/report_frontend_structure.py`
  - The command is report-only by default and exits zero while the alignment
    inventory is still broad.
  - `python3 scripts/report_frontend_structure.py --strict` is the opt-in
    enforcement mode for small, owned violation inventories.
  - The report skips tests, generated output, and declaration files so the
    inventory tracks product source ownership drift.
- Done when:
  - A local command prints a grouped violation inventory.
  - The report identifies existing violations without failing CI.
  - Exceptions, if any, include path, rule, owner/workstream, reason, and
    resolution owner.
  - The output is stable enough for each PR to show progress.

### `frontend-ui-primitives`

- Status: ready to staff after guardrails report exists.
- Canonical docs:
  - `specs/codebase/structures/frontend/guides/components.md`
  - `specs/codebase/structures/frontend/guides/styling.md`
  - `specs/codebase/structures/frontend/packages/README.md`
- Goal:
  - Make `apps/packages/ui/**` the only Desktop/Web DOM primitive layer.
- Scope:
  - Move duplicated primitive definitions into `apps/packages/ui/**`.
  - Replace raw `<button>`, `<input>`, `<label>`, `<select>`, and `<textarea>`
    in Desktop, Web, `product-ui`, and `product-surfaces`.
  - Add missing primitive variants to `apps/packages/ui/**` instead of
    rebuilding control styling at callsites.
  - Keep Mobile on native components and out of DOM packages.
- Done when:
  - Raw DOM control callsites outside `apps/packages/ui/**` are replaced with
    primitives or are listed as rare, owned migration exceptions.
  - Duplicated primitives such as product-local popover menu items are removed
    or redirected to the canonical `ui` primitive.
  - Product/app callsites use concrete `@proliferate/ui/...` subpaths.

### `frontend-hook-normalization`

- Status: ready to staff after guardrails report exists.
- Canonical docs:
  - `specs/codebase/structures/frontend/README.md`
  - `specs/codebase/structures/frontend/guides/hooks.md`
  - `specs/codebase/structures/frontend/guides/access.md`
- Goal:
  - Make hook paths communicate responsibility before opening the file.
- Scope:
  - Move product hook files out of direct `hooks/<domain>/` locations.
  - Normalize product hook folders to `derived`, `workflows`, `lifecycle`,
    `ui`, `cache`, and `facade`.
  - Move generic UI hooks under `hooks/ui/<mechanic>/`.
  - Move external request wrappers and query keys under
    `hooks/access/<system>/<resource>/`.
  - Move nonstandard responsibility folders behind canonical responsibility
    folders by default. Preserve a nonstandard folder only when the PR also
    updates the frontend docs with the narrowly-scoped reason.
- Done when:
  - Product hook domains do not contain direct hook files.
  - Special-purpose hook folders have either moved under documented
    responsibility folders or have explicit doc coverage.
  - Hook imports still use direct concrete paths.
  - Tests or typechecks cover moved hooks with minimal churn.

### `frontend-component-boundaries`

- Status: ready to staff after low-risk primitive and hook moves start.
- Canonical docs:
  - `specs/codebase/structures/frontend/README.md`
  - `specs/codebase/structures/frontend/guides/components.md`
  - `specs/codebase/structures/frontend/guides/hooks.md`
  - `specs/codebase/structures/frontend/guides/lib.md`
  - `specs/codebase/structures/frontend/guides/access.md`
- Goal:
  - Make components render UI, call hooks, and forward callbacks without owning
    access details or multi-step product workflows.
- Scope:
  - Extract component-owned query/mutation orchestration into access,
    workflow, derived, lifecycle, or facade hooks.
  - Move reusable product decisions from components into `lib/domain/**` or
    `apps/packages/product-domain/**`.
  - Keep local component state only for presentation state used by that subtree.
  - Split large screen components by ownership boundary, not arbitrary chunks.
- Done when:
  - Components no longer construct clients, own query invalidation, or call raw
    platform access.
  - Multi-step callbacks live in workflow hooks or `lib/workflows/**`.
  - Extracted components remain UI-only and are named by product domain,
    surface, and role.

### `frontend-page-thinning`

- Status: ready to staff after hook normalization starts.
- Canonical docs:
  - `specs/codebase/structures/frontend/README.md`
  - `specs/codebase/structures/frontend/guides/hooks.md`
  - `specs/codebase/structures/frontend/guides/access.md`
- Goal:
  - Keep Desktop/Web pages as route entrypoints.
- Scope:
  - Move page-owned adapters, access wiring, and product branching into page
    facade or workflow hooks.
  - Keep pages responsible for route params, navigation state, and rendering
    the owning screen or shared surface.
  - Treat callback and handoff pages as thin shells over focused hooks unless
    the feature doc says otherwise.
- Done when:
  - Pages do not import raw access helpers.
  - Pages do not build product adapters with access details inline.
  - Page-level hooks own route-specific orchestration.

### `frontend-workflow-purity`

- Status: ready to staff after related hooks exist.
- Canonical docs:
  - `specs/codebase/structures/frontend/guides/lib.md`
  - `specs/codebase/structures/frontend/guides/hooks.md`
  - `specs/codebase/structures/frontend/guides/access.md`
  - `specs/codebase/structures/frontend/guides/state.md`
- Goal:
  - Make `lib/workflows/**` plain, testable product sequences with explicit
    dependencies.
- Scope:
  - Remove Zustand store imports from `lib/workflows/**`.
  - Remove raw Cloud, AnyHarness, Tauri, and MCP client construction from
    product workflows.
  - Change workflows to `(input, deps)` shape where stable capabilities are
    passed by the owning hook.
  - Keep pure product rules imported from `lib/domain/**` or
    `product-domain`.
- Done when:
  - Workflow tests can use fake dependency objects instead of mocked stores or
    hidden singletons.
  - Workflow files do not import React hooks, stores, query clients, raw
    endpoint paths, or native wrappers.
  - Owning hooks gather access/store/navigation/toast/telemetry deps.

### `frontend-store-lifecycle`

- Status: ready to staff after workflow boundaries are mapped.
- Canonical docs:
  - `specs/codebase/structures/frontend/guides/state.md`
  - `specs/codebase/structures/frontend/guides/hooks.md`
  - `specs/codebase/structures/frontend/guides/lib.md`
- Goal:
  - Keep stores as shared client-only state, with persistence and bootstrap
    owned by lifecycle hooks.
- Scope:
  - Move `localStorage`, `sessionStorage`, Tauri store access, listeners,
    timers, and bootstrap work out of store files.
  - Put hydration, subscriptions, persistence writes, and teardown into
    `hooks/<domain>/lifecycle/**`.
  - Move non-trivial normalization or schema upgrade helpers into
    `lib/domain/**`.
  - Keep store setters as local state intents.
- Done when:
  - Store files do not perform persistence or external side effects.
  - Lifecycle hooks own hydration and cleanup.
  - UI reads normal store state instead of persistence-specific helpers.

### `frontend-shared-package-shape`

- Status: ready to staff after primitive consolidation begins.
- Canonical docs:
  - `specs/codebase/structures/frontend/README.md`
  - `specs/codebase/structures/frontend/packages/README.md`
  - `specs/codebase/structures/frontend/guides/components.md`
- Goal:
  - Make shared package paths and dependencies match the package ownership
    model.
- Scope:
  - Normalize `product-ui` to `src/<domain>/<surface>/**`.
  - Normalize `product-surfaces` to `src/<domain>/<surface>/**`.
  - Remove or rename vague package buckets such as `shared`, `common`,
    `types`, or `utils`.
  - Keep `product-ui` props-in/callbacks-out only.
  - Keep `product-surfaces` connected to shared Cloud SDK React hooks without
    importing app internals.
  - Keep `product-domain` pure and Mobile-safe.
- Done when:
  - Package paths tell the owning domain and surface.
  - Surface names are consistent enough for future callsites to know whether
    they are importing product presentation or a connected Cloud surface.
  - Package import scans show no app internals, stores, routes, Tauri access,
    or unsupported SDK React hooks in disallowed packages.
  - Export-map subpaths stay direct and concrete.

### `frontend-web-chat-decomposition`

- Status: ready to staff after guardrails and enough package primitives exist.
- Canonical docs:
  - `specs/codebase/structures/frontend/README.md`
  - `specs/codebase/structures/frontend/guides/components.md`
  - `specs/codebase/structures/frontend/guides/hooks.md`
  - `specs/codebase/structures/frontend/guides/access.md`
  - `specs/codebase/structures/frontend/guides/lib.md`
  - `specs/codebase/features/chat-composer.md`
  - `specs/codebase/features/chat-transcript.md`
- Goal:
  - Split the Web chat screen into documented frontend owners while preserving
    behavior.
- Scope:
  - Move Cloud access and command wiring into access or workflow hooks.
  - Move UI-ready chat state into derived/facade hooks.
  - Keep pure transcript/composer decisions in `product-domain` or app
    `lib/domain/**` as appropriate.
  - Keep render-only pieces in Web components or shared `product-ui` when they
    are Desktop/Web presentation.
- Done when:
  - The Web chat screen is a thin composition surface.
  - Large callbacks and effects have owners named by responsibility.
  - Feature behavior remains covered by targeted tests or manual verification
    notes.

### `frontend-mobile-chat-decomposition`

- Status: ready to staff after guardrails and Mobile ownership docs are read.
- Canonical docs:
  - `specs/codebase/structures/frontend/README.md`
  - `specs/codebase/structures/frontend/guides/components.md`
  - `specs/codebase/structures/frontend/guides/hooks.md`
  - `specs/codebase/structures/frontend/guides/access.md`
  - `specs/codebase/structures/frontend/guides/state.md`
  - `specs/codebase/features/mobile-cloud-client.md`
  - `specs/codebase/features/chat-composer.md`
  - `specs/codebase/features/chat-transcript.md`
- Goal:
  - Split the Mobile chat screen into native render components, Mobile hooks,
    and shared product-domain rules.
- Scope:
  - Keep Mobile out of DOM packages.
  - Move Cloud/native access into Mobile access hooks or app-local access
    helpers.
  - Move command dispatch and retry orchestration into workflow hooks.
  - Move UI-ready state into derived or facade hooks.
  - Keep native UI in `apps/mobile/src/components/**`.
- Done when:
  - Mobile chat rendering is separated from access and command orchestration.
  - Shared decisions live in `product-domain` only when they are
    cross-platform.
  - Mobile navigation and native UI behavior remain unchanged.

### `frontend-desktop-workspace-decomposition`

- Status: ready to staff after hook and workflow boundaries are underway.
- Canonical docs:
  - `specs/codebase/structures/frontend/README.md`
  - `specs/codebase/structures/frontend/guides/components.md`
  - `specs/codebase/structures/frontend/guides/hooks.md`
  - `specs/codebase/structures/frontend/guides/lib.md`
  - `specs/codebase/features/workspace-files.md`
  - `specs/codebase/features/pending-workspace-shell.md`
- Goal:
  - Align large Desktop workspace shell, sidebar, tabs, files, terminals, and
    transcript-adjacent code with component, hook, workflow, and access
    ownership.
- Scope:
  - Split large Desktop workspace modules by access, lifecycle, derived state,
    workflows, and render roles.
  - Keep local AnyHarness/Tauri access behind access boundaries.
  - Move reusable workspace/sidebar/session display decisions into
    `lib/domain/**` or `product-domain` when shared.
  - Avoid changing workspace behavior while reshaping ownership.
- Done when:
  - High-risk Desktop workspace surfaces have clear owning hooks and render
    components.
  - Large mixed-ownership modules are below the documented threshold or have a
    named reason and owner to remain whole.
  - Targeted workspace/file/session tests still pass.

### `frontend-final-enforcement`

- Status: blocked until the migration exception list is small and owned.
- Canonical docs:
  - all frontend structure docs listed above
  - `specs/developing/deploying/ci-cd.md` if CI enforcement changes
- Goal:
  - Turn the structure report into enforced checks once the repo is aligned
    enough for the checks to be useful.
- Scope:
  - Promote report-only checks to CI failures.
  - Keep any remaining exception list small, named, and owned.
  - Document the command maintainers should run before PRs.
- Done when:
  - CI prevents new violations in the enforced categories.
  - Exceptions are intentional migration records, not silent drift.
  - The final PR title and labels follow release/area rules if CI config
    changes are included.

## Subagent Brief Template

- Workstream:
- Branch/worktree:
- Required docs read:
- Current violations in scope:
- Target owner/path:
- Non-goals:
- Behavior preservation notes:
- Verification plan:
- Remaining exceptions:
- PR summary:

## Coordinator Prompt

The overall coordinator operating model lives in
`specs/tbd/structure-alignment-coordinator-model.md`. Use that document with
this migration tracker when asking Codex to run one workstream, one phase, or
all phases through the implementer, reviewer, fix-up, and merge-readiness loop.

## Implementer Subagent Prompt

Use this prompt for the primary subagent that owns one workstream through an
implementation PR.

```text
You own the `<WORKSTREAM>` frontend structure alignment stream for Proliferate.

You are working in branch/worktree:

- Branch: `<BRANCH>`
- Worktree: `<WORKTREE_PATH>`

Your job is to align code with the existing frontend structure docs. This is
not a broad cleanup project, not a redesign, and not a behavior-change project.
Preserve current behavior and UI unless the stream explicitly requires a
behavior change.

Read these docs before editing:

- `specs/README.md`
- `specs/codebase/structures/frontend/README.md`
- `<FOCUSED_FRONTEND_GUIDES>`
- `specs/codebase/structures/frontend/packages/README.md` if touching shared packages
- `<FEATURE_DOCS>` if touching a covered feature surface
- `specs/tbd/frontend-structure-alignment-migration.md`

Canonical rule summary for this stream:

- `<RULE_1>`
- `<RULE_2>`
- `<RULE_3>`

Scope:

- In scope:
  - `<IN_SCOPE_ITEM_1>`
  - `<IN_SCOPE_ITEM_2>`
  - `<IN_SCOPE_ITEM_3>`
- Out of scope:
  - unrelated refactors
  - cosmetic churn
  - behavior changes not needed for doc alignment
  - changing generated code by hand
  - changing unrelated dirty worktree files

Implementation expectations:

- Use the existing frontend docs as the contract.
- Prefer the repo's existing patterns and direct imports.
- Keep changes narrow and ownership-correct.
- Delete replaced dead code; do not leave duplicate old and new paths.
- If a rule is ambiguous, make the smallest doc clarification needed in the
  same PR, or report the ambiguity if it would change the stream scope.
- Exceptions are allowed only when removing the violation is unsafe in this PR.
  Each exception must name path, rule, owner/workstream, reason, and resolution
  owner.
- Do not preserve nonstandard hook folders by default. Move to documented
  responsibility folders unless you also update the docs with a narrow reason.
- Do not add raw DOM control exceptions by default. Extend or use
  `apps/packages/ui/**` primitives instead.

Verification expectations:

- Run the most focused checks that cover the changed code.
- Prefer package/app typecheck or tests for touched areas when feasible.
- Run any structure report/check relevant to this workstream if available.
- Record commands run and outcomes.
- If a check cannot run, explain why and what risk remains.

Before handing off:

- Summarize the files changed by ownership boundary.
- Summarize how the PR aligns with the named docs.
- List tests/checks run.
- List remaining exceptions or explicitly say there are none.
- Prepare the PR with a title and description that state the alignment stream,
  docs referenced, behavior-preservation notes, and verification.
```

## Reviewer Subagent Prompt

Use this prompt for reviewer subagents after the implementer has opened or
prepared a PR.

```text
You are reviewing the `<WORKSTREAM>` frontend structure alignment PR for
Proliferate.

PR/branch/worktree:

- PR: `<PR_URL_OR_BRANCH>`
- Branch: `<BRANCH>`
- Worktree: `<WORKTREE_PATH>`

Your job is to critique the PR for correctness, doc alignment, ownership, and
regression risk. You are not the implementer. Do not make broad code changes.
If you have GitHub PR comment tools, leave concise review comments directly on
the PR. If not, produce structured review findings with file paths and line
numbers so the coordinator can relay them.

Read these docs before reviewing:

- `specs/README.md`
- `specs/codebase/structures/frontend/README.md`
- `<FOCUSED_FRONTEND_GUIDES>`
- `specs/codebase/structures/frontend/packages/README.md` if the PR touches packages
- `<FEATURE_DOCS>` if the PR touches a covered feature surface
- `specs/tbd/frontend-structure-alignment-migration.md`

Review against these stream rules:

- `<RULE_1>`
- `<RULE_2>`
- `<RULE_3>`

Review checklist:

- Does the PR align code with the canonical frontend docs?
- Did it preserve behavior and UI unless explicitly scoped?
- Did it keep imports direct and avoid barrels or convenience re-exports?
- Did it move code to the correct owner rather than merely moving files?
- Did it avoid introducing new raw DOM controls or duplicate primitives?
- Did it avoid preserving nonstandard hook folders without doc coverage?
- Did it avoid adding store, query-client, raw access, or platform imports in
  disallowed layers?
- Did it avoid app internals inside shared packages?
- Did it delete replaced dead code?
- Are remaining migration exceptions rare, named, owned, and justified?
- Are tests/checks appropriate for the touched behavior and ownership boundary?

Finding format:

- Lead with actionable findings only.
- Include severity:
  - P0: blocks merge, data loss/security/major breakage
  - P1: likely regression or clear doc-contract violation
  - P2: important maintainability/ownership issue
  - P3: minor maintainability suggestion
- Include file path and exact line when possible.
- Explain the impact and the requested fix.
- Do not leave comments for subjective style preferences that are not tied to
  docs, behavior, tests, or maintainability.

Final review output:

- Findings, ordered by severity.
- Questions that affect merge readiness, if any.
- Checks you ran or inspected.
- Short merge-readiness assessment.
```

## Implementer Fix-Up Prompt

Use this prompt to wake the original implementer after reviewer feedback.

```text
Continue the `<WORKSTREAM>` frontend structure alignment PR.

You previously implemented branch/worktree:

- Branch: `<BRANCH>`
- Worktree: `<WORKTREE_PATH>`
- PR: `<PR_URL_OR_BRANCH>`

Review feedback to address:

`<REVIEW_FINDINGS>`

Your job is to fix the PR while preserving the stream scope:

- Address every P0/P1/P2 finding or explain why a finding is intentionally not
  being changed.
- Keep the implementation aligned with the frontend docs and migration tracker.
- Do not add unrelated cleanup.
- Preserve behavior and UI unless the accepted review fix requires a scoped
  behavior change.
- Rerun focused checks after changes.

Before handing back:

- Summarize fixes made by finding.
- List checks run and outcomes.
- List remaining exceptions or unresolved review items.
- Update the PR description if scope, verification, or exceptions changed.
```

## Coordination Notes

- Avoid parallel PRs editing the same hot files unless the workstreams have an
  explicit ordering agreement.
- Primitive and package shape PRs should land before broad component
  decomposition when they would otherwise cause repeated import churn.
- Chat decomposition should be split by platform because Web and Mobile have
  different access, navigation, and rendering constraints.
- Workflow purity should usually follow hook normalization because the owning
  hook needs to gather the dependencies passed into `lib/workflows/**`.
- When a workstream changes generated package exports or build config, run the
  owning package build or typecheck before handing off.
