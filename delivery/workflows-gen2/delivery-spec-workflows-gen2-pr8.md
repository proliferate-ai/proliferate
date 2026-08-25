---
status: Frozen
repository: shark
base_sha: 19d019e0d1e512361c20a53f418d2cbf0c7e4af5
adr_revision: "Supplied Workflows-v2 design package plus founder-approved 2026-08-17 freeze ruling: deterministic layout, camelCase WorkflowDefinitionV2 JSON, conventional delete keys, display-only move, and PR7 graph-rule supersession"
slice: workflows-v2-ui-migration
owner: founder/user
---

# PR <N> — Workflows index and builder use the supplied Workflows-v2 experience without breaking execution

## Outcome

An authenticated user opening Workflows sees the supplied Workflows-v2 index and builder experience, can move through the supplied index → blank/template builder → save flow, and can still list, create, reopen, update, delete, trigger, and open workflow runs through the exact production contracts that exist at the base revision.

The desired visual source is the aligned root package, read with later `COMPONENT-LEDGER.md` entries superseding earlier entries:

- `Workflows - Index.dc.html` SHA-256 `c922cdbd7d4c1a863f1e7265c8b12650058ec23a3ce77d6e7543810824aa621f`;
- `Workflows - Builder.dc.html` SHA-256 `535116f357ac19d8b992ba8dda1e18e2b33a79eedb07c7595eb2a650c731bdef`;
- `Workflows - Flow.dc.html` SHA-256 `06f4ca3f7ffec4b5efd6257ac7835debf5608a6be99b3a6881b52e065aec01c8`;
- `COMPONENT-LEDGER.md` SHA-256 `b700ebc56eb4e3b9fcf11c12b9b57a3a84de4b6588ec6dee94b673f0395f5b05`; and
- `SCOPE-AUDIT.md` SHA-256 `2abbd850a911971d39dd122e9a90467f099784946a8269f7512ec45deb51901f` only where not superseded by the ledger or aligned root artifacts.

The package's `_ds/**`, `support.js`, snapshotted `agent-catalog.js`, fixture records, state/mode switcher strips, flow-trail strip, `Restart flow`, and `embedded` machinery are prototype infrastructure and are not product code. The package's `original/**` files are explicitly frozen pre-alignment artifacts, not implementation authority. The two uploaded PNGs are graph-layout references only and are not shipped assets.

There is no aligned `Workflows - Run.dc.html`. The component ledger calls that screen “next.” Therefore this slice leaves the production workspace-right-panel run experience and its transition-table controls visually and behaviorally unchanged, apart from shared authored terminology explicitly inherited below. Using the archived full-page run split would be an unapproved scope expansion.

The founder approved the supplied-design rulings recorded below. This specification is frozen for implementation at the pinned base revision.

## Current → target flow

### Entry, authentication, and routing

Current:

1. `WorkflowsPage` gates development-auth bypass, unauthenticated access, and missing authenticated identity before mounting any workflow query.
2. With `workflows_v2` disabled, the feature stays dark behind the current unavailable state.
3. `/workflows` renders `WorkflowsMainSurface`; `/workflows/new` renders a new builder seeded from route state; `/workflows/:workflowId` renders the saved definition; an old per-run route redirects to `/workflows` because runs live in a workspace pane.
4. `MainSidebarPageShell` owns app chrome. The aligned artifacts intentionally omit app chrome; they do not authorize removing the production shell.

Target:

- Preserve every gate and route above. Replace only the Workflows-owned content inside the shell.
- Preserve `onNew(template)`, `onEdit(id)`, `onSaved(id)`, Back, and URL replacement semantics. The supplied flow strip is a demonstration of these transitions, not a breadcrumb to implement.
- Preserve the authenticated user id as the Cloud query/mutation cache scope. Never mount Cloud workflow/catalog/repository queries in the access-gate states.

### Workflows index

Current production ownership is already close to the aligned design: `ProductPageShell` contains a header action, a filter, saved-definition and execution groups, empty/error/loading states, delete and trigger dialogs, and a legacy group.

Target anatomy and behavior:

1. Page header: title `Workflows`; supplied description `Saved workflow definitions and the runs recorded from them.`; primary `New workflow` menu.
2. New menu: `Blank workflow` first with a visible platform shortcut badge (`⌘N` in the supplied macOS treatment), separator, `From a template`, then the approved starter templates. Keyboard activation continues through `DropdownMenu`; do not add a bespoke anchored panel.
3. Filter: leading Search glyph, `Input variant="unstyled"`, and owning bottom hairline. It filters the visible title/description of definitions and the visible resolved title of executions. It never searches hidden ids. A no-match query shows `Nothing matches “<query>”.` while leaving the filter editable.
4. Saved Workflows: opaque `Card` group with a header and comfortable `RosterRow`s. Each row keeps its leading workflow `IconTile`, title, description, updated time, row-select-to-edit behavior, Run action, Edit action, and keyboard-navigable overflow menu with destructive Delete.
5. Executions: opaque `Card` group with comfortable `RosterRow`s, newest-first ordering, bounded virtualization, state words, decorative state glyph, elapsed time where terminal, relative creation time, and row-select-to-open-the-exact-workspace behavior.
6. Resolved states from the supplied artifact: default, loading, empty, error, and no-match. Resolved overlays: delete resting/busy/error and trigger resting/busy/error. Prove each in dark and light.
7. Production-only compatibility state: keep the legacy/non-v2 definitions group. A saved row this builder cannot open must remain visible and delete-only rather than disappear.
8. Empty: show four supplied starter cards and a blank-chain action. The aligned starter set is Agentic engineering, Support triage, On-call response, and Bug investigation. Their definitions must use only schema-v2 fields, validate cleanly, omit runtime-local repository defaults, and preserve authored node/input/doc ordering.
9. Error: use the supplied `Workflows could not be loaded` and `The definitions list failed to load. Retrying does not lose any saved work.` copy with a secondary Retry action. Loading remains a status announcement, never an empty state.

Delete flow remains production-authoritative:

- Delete comes from the row overflow menu, not the builder header.
- The request keeps the row's exact `expectedRevision`; another user's or missing definition remains non-enumerating at the server boundary.
- Busy disables dismissal and duplicate submission. Failure keeps the dialog and renders a destructive `NoticeBanner`; success closes it and relies on the owning mutation's normal invalidation.
- Existing runs remain listed; deleting a definition does not delete run history.

Trigger flow remains production-authoritative:

- A Run action loads the exact full v2 record before opening the dialog.
- Render one field per declared input in authored order, including description/optional help.
- Repository options come from the current runtime's `GET /v1/repo-roots` query. An unavailable saved default stays visible but cannot submit.
- Placement stays the wire enum `worktree | repo_root`; do not copy the archived prototype's `scratch` option.
- Confirm is disabled until required inputs and a valid repository are present. Busy disables dismissal and duplicate submission.
- Keep the exact retry identity contract: unchanged retries reuse invocation/run ids; changing any identity input mints a fresh pair. Cloud invocation PUT precedes runtime run PUT. The successful projection writes through to cache, then the exact workspace opens.
- Keep launch diagnostics and their content-free classifications unchanged.

### Builder

Current production already owns the three-pane anatomy, sanctioned form controls, catalog-backed model choices, reference-token preview, repository picker, pannable canvas, validation, optimistic revision save, and all load/save failure states.

Target anatomy:

1. Keep the native-drag-region clearance required by `MainSidebarPageShell`, then a 44px Workflows header with Back, an unstyled mono workflow-title input, a `Graph | JSON` segmented control, and the primary Save Workflow action.
2. Left rail: Add step palette (`Agent`, `Human in the loop`), Context docs heading/count, add-doc action, selected doc rows, and the existing helper copy. The rail is fixed; prototype resize grips are not implemented.
3. Center: shared `WorkflowCanvas` dotted grid, cubic arrowed edges, 200×92 cards, background pan, fit, zoom controls, anchored zoom, clamped framing, overlay-safe fit band, and bottom-left validity/detachment readout. Continue composing the real feature component; do not paste the prototype canvas runtime.
4. Inspector: input/details selection shows description, default repository, and declared inputs; a node selection shows title, human-approval switch, catalog-backed harness/model fields, prompt and `@input:`/`@doc:` preview; a doc selection shows slug, producing node, and starting body.
5. Use only current schema fields. Do not add reasoning effort, trigger-input selectors, goals, verification, file attachments, loop nodes, mode selection, or alternate doc semantics.
6. Terminology inherited from the final ledger: node kind is `Human in the loop` rather than `Approval step`; toggle copy is `Requires human approval`; remove the redundant human-step helper paragraph. `Agent`, retry, and side-node suffixes otherwise stay as current copy.
7. Available harnesses/models continue to come from `useCloudLaunchModelRegistries` through `workflowBuilderHarnessOptions`. The supplied `agent-catalog.js` is fixture glue and must not be copied. Retired/hidden models stay absent; a stored unavailable selection stays visible and blocks save rather than being silently rewritten.
8. Resolved states: input selected, node selected, doc selected, validation issues, saving, loading, missing, unsupported schema, server save error, catalog unavailable, repository list unavailable, and unavailable saved repository. Prove dark and light.
9. Save keeps trimmed title/description, explicit nullable repository default, full-document create/update, server-minted id, optimistic `expectedRevision`, local draft retention on failure/conflict, and query invalidation. No write occurs when local validation fails.

Graph authoring behavior recorded by the final supplied ledger:

- The draft, rather than array order, owns explicit v2 edges.
- The structural Input card participates only in the editor graph. On load, synthesize one visual `Input → head` edge from the unique head of a valid definition. On save, never serialize the Input sentinel; persist only `WorkflowEdgeV2[]` between real node ids.
- Removing a node removes only edges touching it. It does not bridge its predecessor and successor.
- A new node starts detached.
- Dragging from an output port to a real node/input port adds a connection. Refuse self-edges, duplicates, and edges into the structural Input card. A hover/focus-revealed midpoint `IconButton` removes one edge.
- Save is disabled unless the visual graph has one Input-to-head connection and the persisted real-node graph is exactly one linear path covering every node, with every existing definition/reference/repository rule also satisfied.
- Move Up/Down remains in the inspector and changes display order only; it never rewires authored edges.
- Canvas-level Backspace/Delete removes the selected node or doc; Return/Enter does not delete it.
- Canvas-level Cmd/Ctrl+Z and Shift+Cmd/Ctrl+Z undo/redo the whole draft; typing coalesces within the supplied 600ms window; structural edits and one edge-connection drag are one history item; depth is capped at 60. Never intercept these keys while focus is in an input, textarea, select, or contenteditable.
- Keep the deterministic production graph layout and omit free-position card dragging. Node positions are not added to schema or API state and are not presented as persistent authoring data.

JSON authoring behavior is frozen as follows:

- The JSON editor represents the camelCase `WorkflowDefinitionV2` document only. Title, description, and default repository remain outside JSON in their existing envelope/UI fields.
- A syntactically and semantically valid JSON edit applies to the graph draft atomically. An invalid edit preserves the last valid graph, retains the invalid editor text for correction, and blocks Save; it never partially mutates the valid draft.
- Format prettifies the current valid JSON. Revert restores the last valid graph projection.

### Flow and run handoff

Prove these supplied paths through the production router, not a second state machine:

1. Workflows → New workflow → Blank workflow → builder → Save → server-minted definition route.
2. Workflows → New workflow → each approved template → seeded builder → Save.
3. Definition row or Edit action → same saved-definition builder.
4. Builder Back → Workflows.
5. Definition Run → trigger dialog → successful courier → exact workspace selected.
6. Execution row → exact workspace selected, where the existing `WorkflowPane` remains the run view.

The workspace-right-panel `WorkflowPane`, run query polling, transition-table controls (Approve, Fail & redo, type flip, Add side node, Resume), docs opening, session focus, auto-advance undo toast, and interrupted-run resume popover are compatibility obligations, not redesign targets.

## Founder decisions inherited

- The aligned root artifacts, not `original/**`, are the desired UI source.
- The production component library and token authority must be used; “copy” means porting the aligned composition into repository-native React, not importing Design Component runtime code or duplicating primitives.
- Create is the production header `New workflow` menu, with the blank shortcut badge. The old “Create a new workflow” list row and bespoke template panel are excluded.
- Delete remains in the definition row's overflow menu, not the builder header.
- Trigger inputs and the `worktree | repo_root` placement contract remain production-authoritative.
- Node configuration and doc fields remain the schema-v2 production fields. No API/schema expansion for effort, goals, verification, attachments, loops, or alternate doc semantics.
- The run view remains the workspace right-panel pane and exposes only the current legal transition-table actions.
- App chrome is not duplicated inside Workflows. The existing host shell remains.
- The second authoring tab is named JSON, not DSL; its feature component name is `WorkflowJsonEditor`.
- Human node copy is `Human in the loop`; the toggle is `Requires human approval`; the redundant explanatory paragraph is removed.
- The final ledger reverses its earlier linear-order-only ruling: edges are authored, node removal detaches, new nodes start detached, and edge edits participate in undo.
- Keep deterministic graph layout and omit free-position dragging because positions cannot persist without a schema/API change.
- The JSON tab uses camelCase `WorkflowDefinitionV2` JSON. Valid edits apply atomically; invalid JSON preserves the last valid graph and blocks Save; Format prettifies; Revert restores the last valid projection; title, description, and repository remain outside JSON.
- Backspace/Delete removes a selected canvas node or doc; Return/Enter does not.
- Move Up/Down changes display order only and never rewires authored edges.
- This founder ruling explicitly supersedes the older frozen PR7 rules that prohibited graph editing and rebuilt edges from array order.
- The approved main flow is index → blank/template or saved builder → Graph/JSON editing → revisioned save → existing trigger/workspace handoff. Invalid/detached graphs, invalid JSON, and save conflicts retain the local draft and do not write partial state.
- No design token additions are needed. No raster assets are added.

## Primary ownership boundary

ProductClient owns this slice. Pages continue to route; workflow components render; facade/workflow hooks own React orchestration; access hooks own remote queries, mutations, keys, and invalidation; pure domain/lib modules own definition validation, draft transforms, graph geometry, history, and JSON conversion.

Dependency direction remains:

```text
WorkflowsPage
  -> Workflows components
  -> workflow facade/workflow hooks
  -> Cloud/AnyHarness access hooks
  -> existing SDK clients

components
  -> workflow domain/lib projections
  -> sanctioned ProductClient primitives/patterns/icons
  -> design tokens
```

No Desktop/Web host implementation, Tauri call, raw AnyHarness route, raw Cloud endpoint, query-key edit from a component, new store, or new provider belongs in the slice. Desktop and Web receive the change by mounting ProductClient's existing host boundary.

## Interfaces, state, schema, and files affected

### Interfaces that must remain byte/meaning compatible

Cloud control plane:

- `GET/POST /v1/workflows`
- `GET/PUT/DELETE /v1/workflows/{definitionId}`
- `PUT /v1/workflow-invocations/{invocationId}`
- v2 records remain `schemaVersion: 2`, `nodes`, `edges`, optional `inputs`, optional `docTemplates`, envelope title/description/revision/default repository.

Runtime plane:

- current repo-root query;
- `PUT/GET /v1/workflow-runs/{runId}` and current run list/watch behavior;
- all current workflow run command routes and projection shapes.

Database:

- no migration;
- `workflow_definition.definition_json` remains the normalized schema-v2 document;
- revision/user/soft-delete/default-repository behavior is unchanged;
- invocation and runtime workflow tables are unchanged.

React/cache state:

- keep `authCacheScope` on all Cloud workflow keys;
- keep access-hook ownership of invalidation/write-through/retry;
- keep component-local index filter/dialog target and builder selection;
- builder draft/history/edge state belongs in `useWorkflowBuilder` plus pure draft helpers, not in a global store;
- JSON parse text/status is local authoring state and cannot mutate the valid graph draft until a complete parse/validation succeeds.

### Expected write scope

Primary existing files:

- `apps/packages/product-client/src/pages/WorkflowsPage.tsx` only if route-state wiring needs adjustment; route/auth behavior is otherwise unchanged.
- `apps/packages/product-client/src/components/workflows/main/WorkflowsMainSurface.tsx`
- `apps/packages/product-client/src/components/workflows/main/WorkflowMainDefinitionRow.tsx`
- `apps/packages/product-client/src/components/workflows/main/WorkflowMainExecutionsGroup.tsx`
- `apps/packages/product-client/src/components/workflows/main/WorkflowMainEmptyState.tsx`
- `apps/packages/product-client/src/components/workflows/main/WorkflowMainNewMenu.tsx`
- `apps/packages/product-client/src/components/workflows/main/WorkflowMainDeleteDialog.tsx`
- `apps/packages/product-client/src/components/workflows/trigger/WorkflowTriggerDialog.tsx`
- `apps/packages/product-client/src/components/workflows/builder-v2/WorkflowBuilderSurface.tsx`
- `apps/packages/product-client/src/components/workflows/builder-v2/WorkflowBuilderChainCanvas.tsx`
- `apps/packages/product-client/src/components/workflows/builder-v2/WorkflowBuilderNodeCard.tsx`
- builder rail/details/input/doc/prompt files only where the aligned composition or state proof requires it;
- `apps/packages/product-client/src/components/workflows/canvas/WorkflowCanvas.tsx`
- `apps/packages/product-client/src/hooks/workflows/facade/use-workflow-builder.ts`
- `apps/packages/product-client/src/lib/domain/workflows/workflow-builder-draft.ts`
- `apps/packages/product-client/src/lib/domain/workflows/workflow-builder-validation.ts`
- `apps/packages/product-client/src/domain/workflows/graph-layout.ts`
- `apps/packages/product-client/src/config/workflows/starter-templates.ts`
- `apps/packages/product-client/src/copy/workflows/workflow-main-copy.ts`
- `apps/packages/product-client/src/copy/workflows/workflow-builder-copy.ts`
- `apps/packages/product-client/src/copy/workflows/workflow-node-card-copy.ts`
- colocated workflow tests and existing Tier-2 intent specs.

New feature file:

- `apps/packages/product-client/src/components/workflows/builder-v2/WorkflowJsonEditor.tsx` (first-instance feature component, not a primitive or sanctioned library pattern).

Documentation:

- Record the changed current Workflows UI behavior in the authoritative Workflows documentation selected by the repository docs system.
- Do not silently edit the frozen `delivery-spec-workflows-gen2-pr7.md`: it explicitly names graph canvas/drag-drop as non-goals and linear edge rebuilding as a test obligation. The founder-approved supersession in this specification must be called out in the PR description under the Constitution.
- Run `python3 scripts/check_docs.py` for any repository-doc change.

No expected changes:

- `apps/packages/design/**` tokens/CSS;
- ProductClient primitives/patterns/icons unless an exact missing icon is discovered (none is currently known);
- Cloud SDK or Cloud SDK React types/clients/hooks;
- AnyHarness SDK or SDK React types/clients/hooks;
- server, Alembic, AnyHarness Rust, SQLite, or Postgres sources;
- run-view components/hooks/domain modules, except tests that establish no regression from shared copy.

## Failure, migration, deletion, and compatibility behavior

- This is an in-place UI replacement. Do not leave a duplicate old index/builder path, a feature toggle selecting two implementations, or copied Design Component files in the repository. Delete dead Workflows presentation/helpers made obsolete by the replacement.
- No data migration exists. Existing v2 definitions reopen without rewrite; legacy rows remain visible/delete-only; existing invocations/runs/docs remain usable.
- Never silently repair or rewrite stored unavailable model/repository selections.
- Removing a graph node may remove its incident edges in the unsaved draft, but it never mutates the server until Save and never deletes run/session/doc history.
- Invalid/detached graphs, invalid prompt references, duplicate/invalid ids/names/slugs, unknown doc producers, blank required fields, unavailable repository defaults, and invalid JSON must block Save before a request.
- Server validation remains authoritative. A rejected create/update retains the local draft, including authored edges and JSON text; optimistic revision conflict does not overwrite the newer server row.
- Missing/foreign definitions remain non-enumerating and render the current missing state. Unsupported schema stays refused rather than coerced into v2.
- Passive query failure with usable cached data keeps usable data on screen where current code does so. Index primary-list failure keeps Retry. Execution-roster failure remains quiet and must not take down definitions.
- Delete and trigger busy/error behavior remains as described above; duplicate click must not create a second mutation or run.
- Run view, session focus, docs, transition legality, run polling, interruption, cancellation/failure projection, and restart behavior remain unchanged.
- All user-content surfaces remain under `data-telemetry-block`; prompts, arguments, document bodies, definition JSON, titles, repository labels, paths, provider responses, and raw error chains never enter telemetry or error copy.
- Accessibility is functional, not visual: every node/doc/row/action is keyboard reachable; selection uses `aria-pressed` or an equivalent correct semantic; graph geometry is decorative; dialogs retain focus trap/dismissal; state is stated in words, never only color.
- Light and dark modes use existing semantic tokens. Reduced-motion behavior inherits the design system. No raw color, arbitrary radius/shadow, raw duration/easing, raw Radix import, raw DOM control, or direct icon-package import may land.

## Acceptance proof

### Automated proof

Tier 1, ProductClient:

- Expand `WorkflowsMainSurface.test.tsx` to cover supplied default/loading/empty/error/no-match states, four starter templates, shortcut/menu routing, delete resting/busy/error, trigger resting/busy/error, legacy compatibility, and execution-row workspace opening.
- Expand builder surface/facade/draft/validation/layout tests to cover every selection/resource state, create/update mapping, dirty/saving/saved/error behavior, unavailable catalog/repository selections, explicit edge add/remove, node removal without auto-heal, new detached node, Input-sentinel projection, linear-path save gate, move-without-rewire, undo/redo/coalescing/depth, keyboard focus scoping, and graph fit/zoom/pan invariants.
- Add JSON editor/parser tests for valid graph→JSON projection, valid JSON→graph atomic apply, malformed/semantically invalid JSON keeping the last valid graph, Format, Revert, title/envelope handling, unknown fields, and save gating.
- Update template tests so all four templates pass `validateDefinitionV2`, have declared references/doc producers, and seed no repository id.
- Preserve existing trigger courier identity/order/write-through/diagnostics tests and run-view transition-table tests unchanged.
- Negative controls must fail if edges are ignored: deleting a middle node must leave two disconnected pieces and block Save; a test implementation that simply derives edges from array order must fail.

Tier 2:

- Evolve `tests/intent/specs/workflow-definitions.spec.ts` to create through the aligned builder, prove local invalid/detached graph gating, save, reload, reopen exact persisted v2 fields/edges/order, edit, revisioned resave, delete, and disappearance from the normal list.
- Preserve `tests/intent/specs/workflow-trigger-seam.spec.ts`: one invocation PUT, exact declared arguments/placement, stop at the missing runtime seam, no fake sandbox or LLM.
- No real agent or sandbox belongs in the merge gate. Existing Tier-3 Workflow acceptance remains release evidence and is not expanded merely for appearance.

Commands, narrowed first and broadened in proportion to the diff:

```text
pnpm --filter @proliferate/product-client test
pnpm --filter @proliferate/product-client typecheck
pnpm --filter @proliferate/web typecheck
pnpm --filter @proliferate/desktop typecheck
pnpm -C tests/intent lint
pnpm -C tests/intent typecheck
python3 scripts/check_appearance_scaling.py
python3 scripts/check_frontend_boundaries.py
python3 scripts/check_component_library.py
python3 scripts/report_frontend_structure.py --strict --summary-only
python3 scripts/check_design_attribution.py
python3 scripts/check_docs.py     # when docs change
```

Use actual package scripts present at implementation time if a command spelling differs; do not weaken a checker, add an exception, grow a census, or alter a pinning test to make the slice pass.

### Screenshot/demo

Capture comparable product screenshots, not prototype screenshots, from the real ProductClient renderer in both dark and light:

- index default with Saved Workflows and Executions;
- index empty with all four starter templates;
- index error and no-match;
- delete dialog resting, busy, and error;
- trigger dialog with declared inputs, placement, busy, and error;
- builder input selection, node selection, doc selection, validation/detached graph, saving, missing, and unsupported;
- builder graph after removing a middle node (incident edges are removed, no reconnection occurs, and Save is blocked); and
- builder JSON valid and invalid states.

Manual demo on the documented isolated local profile:

1. create each blank/template entry path;
2. exercise Back and saved-definition Edit;
3. edit declared inputs/docs/model/prompt references;
4. add/remove/reconnect a node and prove Save gating;
5. prove undo/redo and keyboard focus scoping;
6. save, reload, reopen, edit, and delete;
7. launch through the real trigger dialog and verify the existing workspace handoff;
8. open an execution and smoke the unchanged right-panel run controls/docs/session focus; and
9. verify narrow/windowed layouts and both color modes.

The PR handoff stops with the isolated local app running and gives the profile name plus URL/window entrypoint. It does not claim acceptance from screenshots alone.

### Observability/docs

- Observability delta: none. Preserve existing `renderer.workflows.launch_submitted`, `renderer.workflows.launch_failed`, run-command diagnostics, and telemetry-block boundaries. Do not add drag/filter/editor analytics in this slice.
- Error reporting remains one capture path with safe ids/classifications only; no JSON, prompts, doc bodies, repository names, paths, arguments, or raw failures.
- Update current Workflows docs for the frozen editor behavior and explicitly record the supersession of PR7's linear-order/drag-drop non-goal. Include `Testing` and `Observability: none` in the PR description.

## Explicit non-goals

- No server endpoint, SDK wire type, database column/table/index, migration, runtime contract, workflow actor/manager, execution transition, run state, placement enum, query-key shape, or authentication change.
- No redesign of `WorkflowPane`, the workspace shell/right panel, chat/session transcript, docs viewer, resume popover, auto-advance toast, run command dialogs, or execution engine.
- No full-page run split, Cancel run, Retry run, “Goal achieved · Continue,” Open in JSON from the run view, scratch placement, schedules, webhooks, triggers, grants, integrations, goals, verification, reasoning effort, file attachments, loop/branch execution, or additional node kinds.
- No duplicate app sidebar/chrome inside Workflows.
- No import of `_ds/**`, `support.js`, `agent-catalog.js`, Design Component runtime, fixture definitions/runs, flow trail, prototype state switchers, or archived `original/**` markup.
- No new design tokens, raw styles, component-library kit, convenience barrel/re-export, or speculative shared primitive.
- No unrelated cleanup or repair outside Workflows and its directly reused component/copy tests.
- No PR creation, ticket linking, local launch, merge, deploy, or production enablement in this specification node.

## Dependencies and deferred decisions

There are no remaining freeze blockers or deferred product decisions for this slice. The founder-approved deterministic-layout, JSON-authoring, keyboard-deletion, display-order, and PR7-supersession rulings are normative under Founder decisions inherited.

### Known dependencies

- Founder review has approved superseding the frozen PR7 normative statements that graph editing is a non-goal and that edges rebuild linearly from card order. The implementation and PR description must record that supersession explicitly.
- The implementation must start from the exact base SHA or re-audit all cited current contracts against the new base.
- The current Workflows design package includes no aligned run artifact. A later run-view redesign needs its own supplied artifact and slice.
- Corresponding product tickets and PR metadata are discovered and linked only in the later PR-delivery stage; none are invented here.

## Implementation handoff

- Repository: `shark`.
- Base SHA: `19d019e0d1e512361c20a53f418d2cbf0c7e4af5`.
- Spec revision/hash: Frozen; use the externally reported SHA-256 of this artifact as the exact implementation contract.
- Permitted repository write scope after freeze: ProductClient Workflows routes/components/hooks/domain/lib/copy/config and their colocated tests; existing Workflow Tier-2 intent specs; the authoritative Workflows documentation required to describe the frozen behavior. Shared primitives/design, SDKs, server, DB, runtime, and unrelated hosts are read-only unless the founder explicitly expands the slice.
- Source priority during implementation: frozen specification and explicit founder rulings for desired behavior; aligned root design package for visual composition; base-revision code/schema/tests for current behavior and wiring; repository governing docs for ownership and proof.
- Stop after implementation/review/proof, draft PR with ticket links, and isolated local launch. Do not merge, deploy, mark ready, or expand into the run-view redesign.

---

## Founder re-ruling — title correction (2026-08-25)

The heading of this specification froze with the unfilled template placeholder
`PR <N>`. Per the `delivery/**` authority model (a frozen artifact is never
hand-edited except to record a founder re-ruling), this note records the
correct title rather than rewriting the frozen heading:

> PR 8 — Workflows index and builder use the supplied Workflows-v2 experience
> without breaking execution

No other content of this frozen specification is modified or reinterpreted by
this note.

Ruled by: founder — sign-off recorded in the pull request that lands this note.
