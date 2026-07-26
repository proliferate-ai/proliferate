# Taxonomy batch progress (working file — deleted in final commit)

Plan: moves.tsv (37 moves; unlisted files stay). Infra allowlist (stay at src root): lib/, utils/, overlays/, css/test-setup if present.

Judgment calls (JC):
- kit/Checkbox + kit/Tooltip collide with styled primitives namesakes → checkbox-primitive.tsx / tooltip-primitive.tsx (raw layer, lowercase module style); ruled future merge collapses them.
- kit/Command → primitives (raw cmdk wrapper); CommandPalette (composition) → patterns.
- FixedPositionLayer, RowActionIconButton, PopoverSearchField → primitives (low-level building blocks; PopoverSearchField not moved, already in primitives).
- AuthProviderButton, ListRow, EmptyState → patterns (compositions).
- AnimatedSwapText/AnimatedCollapsibleContent stay primitives; ThinkingText → patterns per catalog table.
- icons.tsx barrel → icons/index.tsx.
- Step 3 JC: no tsup.config, no vitest.config, no path aliases anywhere in the ui package (tsconfig include is just `src/**/*`, package.json scripts are plain `tsc`/`vitest run`) — nothing to rewrite there beyond the exports map and source imports themselves.
- Step 3 JC: `./icons` export subpath key kept as-is (barrel still lives at that public subpath); only its dist target moved from `dist/icons.js` to `dist/icons/index.js` since the source file moved to icons/index.tsx.
- Step 3 JC: two SidebarNavRow test files now coexist — legacy `test/SidebarNavRow.test.tsx` (repointed to `../src/patterns/SidebarNavRow`) and the new co-located `src/patterns/SidebarNavRow.test.tsx` from the git-mv of `layout/SidebarNavRow.test.tsx`. They assert different things and both pass under vitest's default glob; left both in place since dedup/relocation wasn't in scope for this step.
- Step 4 JC: rewrite was specifier-only via a regex keyed off the exact old→new export-map diff (commit 0cf5b8cd8) — matched `@proliferate/ui/<old-subpath>` immediately followed by a closing quote/backtick, so e.g. `primitives/ComposerTextareaFrame` never partially matched inside `primitives/ComposerTextarea`. No hits at all in apps/desktop/src or apps/web/src (they don't import `@proliferate/ui` directly). No Tailwind `@source` globs or storybook configs reference the old kit/layout dirs — `apps/packages/design/src/css/dom.css` only globs `.../ui/src` (package root, unaffected by the internal taxonomy move) not `.../ui/src/kit` or `.../ui/src/layout`, so nothing to fix there.
- Step 4 JC: left three categories of old-path references untouched as out of scope for this step (explicitly step 5's "specs/ links + appearance-baseline key renames" or otherwise non-specifier prose): `specs/codebase/structures/frontend/packages/README.md` (prose mentioning `@proliferate/ui/kit/Dialog`), `scripts/appearance_scaling_baseline.json` (baseline keys literally named `apps/packages/ui/src/kit/...`), and `scripts/check_appearance_scaling.py` / `scripts/test_check_appearance_scaling.py` / `apps/desktop/scripts/check-design-system.sh` (reference `@proliferate/ui/icons` and `@proliferate/ui/utils/tw-merge`, both of which are unchanged canonical subpaths already, not stale ones — no edit needed there regardless).
- Step 4 gates: `pnpm run shared:typecheck` exit 0; `pnpm --filter @proliferate/product-ui test` 31 files/193 tests passed; `pnpm --filter @proliferate/product-client test` 631 files/3823 tests passed. All green on first run, no pre-existing failures encountered.
- Step 5 JC: `specs/codebase/structures/frontend/packages/README.md` described `kit/` as a live, going-forward directory with its own `@proliferate/ui/kit/<Component>` specifier convention and a `kit/`↔`primitives/` transitional-overlap rule (4 named pairs: Checkbox, Tooltip, Popover family, Dialog family). That directory no longer exists post-move (`kit/` was absorbed into `primitives/`; `layout/` was split into `primitives/`+`patterns/`), so this was a factual-architecture staleness, not just a broken link — rewrote the `ui/` subsection (directory tree, `kit/` sub-heading → `primitives/` base-tier description, specifier examples) to match the actual two-pair collision that survived the move (`checkbox-primitive.tsx`/`Checkbox.tsx`, `tooltip-primitive.tsx`/`Tooltip.tsx`, both still inside `primitives/`), and dropped the now-nonexistent third/fourth pairs (Popover family and Dialog family resolved to single files, no overlap left). Same staleness echoed in one line of `specs/codebase/structures/frontend/README.md`'s package table (`kit/` Radix tier + legacy `primitives/`) — updated to `primitives/` base tier + `patterns/` compositions.
- Step 5 JC: left `specs/codebase/systems/product/chat/composer.md:561`'s `components/ui/icons.tsx` / `components/ui/Button.tsx` references untouched — these predate the `apps/packages/ui` package entirely (April 2026 desktop-local doc, `docs/frontend/chat-composer.md` origin), not a reference to this taxonomy's `ui/src` tree; unrelated staleness, out of scope for this step.
- Step 5 JC: `scripts/appearance_scaling_baseline.json`'s `standardNumericZ.apps/packages/ui/src/kit/ContextMenu.tsx|z-50` key left as-is — `kit/ContextMenu.tsx` was deleted outright (zero-importer cull, commit a74a216e7), never appears in moves.tsv, and has no rename target; it's pre-existing baseline staleness from a deletion, not a path this taxonomy move touched. Gate is green with it present (the guard only checks it doesn't allocate more than actual usage, and actual usage for a deleted file is legitimately 0 forever headroom-free since nothing can match a nonexistent path).
- Step 5 gates: `python3 scripts/check_docs.py` (224 files) exit 0; `python3 scripts/check_appearance_scaling.py` exit 0 (only after the 7 `standardNumericZ` key renames — pre-rename it failed with 7 `standard-z-addition` violations because the guard matches baseline keys literally against current file paths); `python3 scripts/check_frontend_boundaries.py` exit 0; `PYTHONPATH=. python3 -m scripts.test_check_docs` 17 tests OK; `PYTHONPATH=. python3 -m scripts.test_check_appearance_scaling` 49 tests OK (run since the baseline file was edited).

Steps:
- [x] 1. Plan committed
- [x] 2. git mv per moves.tsv (pure renames, no content edits)
- [x] 3. ui-internal wiring: relative imports, exports map, tsup/tsconfig/vitest paths; ui builds green
- [x] 4. external consumers: product-ui/product-surfaces/product-client/apps rewrites + tailwind @source globs; shared:typecheck green
- [x] 5. specs/ links + appearance-baseline key renames; check_docs + appearance + boundaries green
- [x] 6. product-ui patterns/ grouping (M2)

## Step 6 move list (product-ui library citizens -> src/patterns/)

Authority: catalog-v2-snapshot.md §4.2 (Patterns table) + seed list from task
brief. Target dir: `apps/packages/product-ui/src/patterns/` (new; created by
this step's first git mv). Tests move with their component (none of these
seed files currently have a co-located `.test.tsx` except `ModelTable`).

| # | Current path | New path | §4.2 row / seed reason |
|---|---|---|---|
| 1 | `src/settings/SettingsRow.tsx` | `src/patterns/SettingsRow.tsx` | §4.2 row, BLOCKED-but-seed-listed |
| 2 | `src/settings/SettingsSection.tsx` | `src/patterns/SettingsSection.tsx` | §4.2 row, seed |
| 3 | `src/settings/SettingsPageHeader.tsx` | `src/patterns/SettingsPageHeader.tsx` | §4.2 row, seed |
| 4 | `src/settings/SettingsEyebrow.tsx` | `src/patterns/SettingsEyebrow.tsx` | §4.2 row, seed |
| 5 | `src/settings/SettingsEmptyState.tsx` | `src/patterns/SettingsEmptyState.tsx` | §4.2 row, seed |
| 6 | `src/settings/SettingsSaveFooter.tsx` | `src/patterns/SettingsSaveFooter.tsx` | §4.2 row (INBOUND-SAFE), seed |
| 7 | `src/settings/SettingsScopeTabs.tsx` | `src/patterns/SettingsScopeTabs.tsx` | §4.2 row (INBOUND-SAFE), seed |
| 8 | `src/settings/ModelTable.tsx` | `src/patterns/ModelTable.tsx` | §4.2 row (INBOUND-SAFE), seed |
| 9 | `src/settings/ModelTable.test.tsx` | `src/patterns/ModelTable.test.tsx` | co-located test, moves with #8 |
| 10 | `src/workspaces/PrStatusBadge.tsx` | `src/patterns/PrStatusBadge.tsx` | §4.2 row, seed |
| 11 | `src/layout/ProductPageShell.tsx` | `src/patterns/ProductPageShell.tsx` | §4.2 row, seed |
| 12 | `src/secrets/SecretManagementPanel.tsx` | `src/patterns/SecretManagementPanel.tsx` | D5/seed: presentational secrets pattern half |

### Explicitly NOT moved (seed list scope + conservative default), with reasoning

- `src/secrets/{SecretDeleteDialog,SecretEditorDialog(.test),SecretList,SecretRow,SecretScopeNotice}.tsx`
  — task says move "the D5 pattern half" of SecretManagementPanel, i.e. only
  the top-level presentational pattern that D5/§4.2 names. These five are
  `SecretManagementPanel`'s private implementation detail (dialog/list/row
  building blocks), not independently catalogued in §4/§4.2, and have zero
  importers outside `SecretManagementPanel` itself (verified by grep). They
  stay with `SecretManagementPanel`'s former neighborhood — actually, since
  they're pure internals of the moved component, they move to
  `src/patterns/secrets/` as a same-step sub-move (see below) rather than
  splitting the implementation across two directories.
- `src/settings/RepoPicker.tsx` — not in the seed list, not a §4.2 row (not
  in the catalog table at all: it's a repo-scope header picker, not a
  cataloged pattern). Zero external importers found via grep of the whole
  tree beyond its own file — feature-scoped, stays.
- `src/settings/OrganizationSsoSettingsSurface.tsx` — not in seed list or
  §4.2; it's the connected SSO settings surface (§6 dissolution-plan territory:
  "CloudOrganizationSsoSettingsSurface" is explicitly listed as staying out of
  the library table, dissolving into feature code). Stays.
- `src/workspaces/{RecentWorkStatusDot,WorkspaceInventory*,WorkspaceReconciliationBody,WorkspacesCommandList}.tsx`
  — not in seed list; none appear as §4.2 rows. `WorkspacesCommandList`
  internally imports `PrStatusDot` from the moved file (relative import fixed
  in step 2 wiring) but is itself a feature-level command-list body, not a
  cataloged pattern. Stays, per conservative-default instruction.
- `src/layout/ProductNotice.tsx` — not in seed list, not a §4.2 row. Stays.
- `src/account/*`, `src/chat/*` (incl. transcript family), `src/sidebar/*`,
  `src/workflows/*`, `src/billing/*`, `src/environments/*`, `src/repos/*`,
  `src/activity/*`, `src/code/*`, `src/auth/*` — none of these are in the
  seed list; §4.2 rows that live in these dirs today (none do — all §4.2
  `product-ui`-sourced rows are `settings/`, `workspaces/PrStatusBadge`, or
  `layout/ProductPageShell`, all covered above) confirm nothing else in these
  trees is catalog-assigned to move this step. Explicitly the
  "feature/screen-level files, transcript family, workspaces feature bodies"
  the task brief says to leave. Not moved.

### Sub-move addendum: SecretManagementPanel's internals travel with it

Revised target: `SecretManagementPanel.tsx` and its five private
implementation files move together into a new
`src/patterns/secrets/` subfolder (not flat into `src/patterns/`), since
splitting one component's dialog/list/row internals across two directories
(`patterns/` vs `secrets/`) would break the file-adjacency convention every
other pattern in this package follows. Only `SecretManagementPanel.tsx`
itself gets a public package.json export subpath
(`./patterns/secrets/SecretManagementPanel`); the five internals stay
unexported (no export map entry), matching their current unexported status.

Revised row 12: `src/secrets/SecretManagementPanel.tsx` -> `src/patterns/secrets/SecretManagementPanel.tsx`,
plus (moving with it, same commit):
- `src/secrets/SecretDeleteDialog.tsx` -> `src/patterns/secrets/SecretDeleteDialog.tsx`
- `src/secrets/SecretEditorDialog.tsx` -> `src/patterns/secrets/SecretEditorDialog.tsx`
- `src/secrets/SecretEditorDialog.test.tsx` -> `src/patterns/secrets/SecretEditorDialog.test.tsx`
- `src/secrets/SecretList.tsx` -> `src/patterns/secrets/SecretList.tsx`
- `src/secrets/SecretRow.tsx` -> `src/patterns/secrets/SecretRow.tsx`
- `src/secrets/SecretScopeNotice.tsx` -> `src/patterns/secrets/SecretScopeNotice.tsx`

This empties `src/secrets/` entirely — directory removed.

### External consumers requiring specifier rewrites (verified by grep)

- `SettingsRow`: product-surfaces (2 files: BillingManagementCards,
  BillingUsageUnitsSection) + product-client (13 files) + product-ui internal
  (BillingOwnerCard, SecretManagementPanel(moving), CloudEnvironmentConfigSection,
  CloudEnvironmentList — relative imports, fixed in step-6 wiring not export map)
- `SettingsSection`: product-surfaces (2) + product-client (27) + product-ui
  internal (5 relative-import sites)
- `SettingsPageHeader`: product-surfaces (1: BillingSettingsSurface) +
  product-client (23) + product-ui internal (OrganizationSsoSettingsSurface,
  CloudEnvironmentList — relative)
- `SettingsEyebrow`: product-client (4) + product-ui internal (SettingsSection,
  relative)
- `SettingsEmptyState`: product-client (16)
- `SettingsSaveFooter`: product-client (2)
- `SettingsScopeTabs`: product-client (1: SettingsScreen)
- `ModelTable`: product-client (1: HarnessAllModelsSection)
- `PrStatusBadge`: product-client (2: SidebarWorkspaceGitGlyph,
  pr-status-presentation.ts, type-only imports) + product-ui internal
  (WorkspacesCommandList, ProductSidebarRepositories — relative)
- `ProductPageShell`: product-surfaces (1: WorkflowResourceState) +
  product-client (1: WorkflowDefinitionsAccessScreen) + product-ui internal
  (WorkflowDefinitionList, WorkflowDefinitionEditor, WorkflowRunDetail —
  relative)
- `SecretManagementPanel`: product-client (3: PersonalSecretsPane,
  OrganizationSecretsPane, RepoEnvironmentPane, + the
  `use-cloud-secrets-panel.ts` hook's type-only import)

Package.json `exports` map: 10 subpath keys change target
(`./settings/X` -> `./patterns/X` for the 8 settings-family entries incl.
ModelTable; `./workspaces/PrStatusBadge` -> `./patterns/PrStatusBadge`;
`./layout/ProductPageShell` -> `./patterns/ProductPageShell`;
`./secrets/SecretManagementPanel` -> `./patterns/secrets/SecretManagementPanel`).
No aliases kept — canonical rename only, per task instruction. Consumers
import via exact deep subpaths (verified: every external import is
`@proliferate/product-ui/<subpath>/<Component>`, no barrel) so this is a
mechanical specifier rewrite, not a public-API shape change.

Docs touched (prose only, not markdown links — `check_docs.py` validates
link targets/anchors, and grep found zero markdown-link-syntax references to
any moved path): `specs/codebase/systems/product/settings/information-architecture.md`
(§5.4 shared-primitives block, §6 files-to-change SettingsScopeTabs line),
`specs/codebase/systems/product/clients/cloud-local-parity.md` ("Web Settings"
section, `product-ui/src/settings/**` prose x2). `check-design-system.sh` line
99 references `@proliferate/product-ui/settings` as a generic subpath
namespace in an error message, not a specific broken import — left as-is
(still true: `settings/` still exists with RepoPicker/OrganizationSsoSettingsSurface
in it; the message is about the namespace convention, not a literal existing
export).

Step 6 JC (final, post-execution):
- One file the move list didn't anticipate: `apps/packages/product-ui/test/SettingsSection.test.tsx`
  (a legacy top-level `test/` dir, sibling to `src/`, pre-dating the co-located-test
  convention) imported `SettingsRow`/`SettingsSection` via `../src/settings/...` —
  the only test for either component (no co-located `.test.tsx` existed for them
  in `src/settings/` before the move). Fixed its two import paths to
  `../src/patterns/...`; this is the one file outside `src/` this step touched.
- `apps/desktop/scripts/check-design-system.sh` line 99's error-message string
  said "route settings markup through the shared primitives in
  `@proliferate/product-ui/settings`" — factually stale after this move (the
  primitives the comment/rule actually enforces — SettingsRow/SettingsSection/
  SettingsPageHeader/SettingsEmptyState — all now live under `patterns/`, not
  `settings/`). Updated the string to `@proliferate/product-ui/patterns`. This
  is prose in an echo statement, not a real import specifier, so it wasn't
  caught by the mechanical rewrite pass.
- `SecretManagementPanel`'s five private internals (`SecretDeleteDialog`,
  `SecretEditorDialog`(+test), `SecretList`, `SecretRow`, `SecretScopeNotice`)
  moved with it into `patterns/secrets/` rather than staying split across two
  directories — none are independently catalogued in §4/§4.2, none have
  importers outside `SecretManagementPanel.tsx` (verified), so this is an
  adjacency call, not a separate catalog decision. Only `SecretManagementPanel`
  itself got a new package.json export subpath (`./patterns/secrets/SecretManagementPanel`);
  the five internals stay unexported, matching their prior unexported status.
  `src/secrets/` is now empty and was removed (git doesn't track empty dirs).
- Left in place despite living in a moved-from directory (conservative
  default, no §4.2 row, not in seed list): `settings/RepoPicker.tsx`,
  `settings/OrganizationSsoSettingsSurface.tsx` (§6 dissolution-plan surface,
  explicitly named as staying out of the library table),
  `workspaces/{RecentWorkStatusDot,WorkspaceInventory*,WorkspaceReconciliationBody,WorkspacesCommandList}.tsx`,
  `layout/ProductNotice.tsx`. See the move-list section above for full
  per-file reasoning already logged before execution — none of that reasoning
  changed during the move itself.
- Gates (this step, run in the sequence specified): `pnpm run shared:typecheck`
  exit 0 (product-domain/ui/product-ui/product-surfaces/product-client
  typecheck all clean). `pnpm --filter @proliferate/product-ui test`: 31 files
  / 193 tests passed (same counts as step 4's baseline — one failure surfaced
  first run from the `test/SettingsSection.test.tsx` stale import above, fixed,
  re-run green). `pnpm --filter @proliferate/product-client test`: 631 files /
  3823 tests passed (identical counts to step 4's baseline — no regression).
  `python3 scripts/check_appearance_scaling.py` exit 0, no baseline key renames
  needed (grep confirmed zero baseline entries reference any moved file's old
  path — `OrganizationSsoSettingsSurface.tsx`, the one settings-dir file with a
  baseline entry, did not move). `python3 scripts/check_frontend_boundaries.py`
  exit 0. `python3 scripts/check_docs.py` exit 0 (224 files) after updating
  prose (not markdown links — none existed to any moved path) in
  `specs/codebase/systems/product/settings/information-architecture.md` (§5.4
  primitives block, §6 SettingsScopeTabs file line) and
  `specs/codebase/systems/product/clients/cloud-local-parity.md` ("Web
  Settings" section + Desktop-settings sharing-model bullet, both `product-ui/src/settings/**`
  mentions that were about the moved primitives specifically). Also reran
  `PYTHONPATH=. python3 -m scripts.test_check_docs` (17 OK) and
  `PYTHONPATH=. python3 -m scripts.test_check_appearance_scaling` (49 OK) since
  step 5 last ran them and this step didn't change either checker's logic —
  both still green, confirming no checker regression.
- [x] 7. boundary gate rules (G)

## Step 7 notes

Two mechanically-checkable rules added to `scripts/check_frontend_boundaries.py`,
same style as the file's existing per-line/per-tree checks (no fuzzy heuristics):

- `RADIX_IMPORT_OUTSIDE_UI_COMPONENT_LIBRARY`: any `@radix-ui/*` import (substring
  match on `"@radix-ui/"`, comment-stripped, same convention as the other
  per-line rules in this file) outside `apps/packages/ui/src/primitives/**` or
  `apps/packages/ui/src/patterns/**` fails. Scanned across all nine frontend
  package/app src roots (desktop, web, mobile, design, ui, product-domain,
  product-ui, product-surfaces, product-client) via a new
  `find_radix_import_violations()` + `ALL_FRONTEND_SRC_ROOTS`/`iter_files_in_roots`
  helper (the prior `iter_frontend_files()` only scanned desktop+product-client,
  too narrow for a repo-wide dependency-containment rule). Verified zero
  violations exist today (`@radix-ui/*` only appears in `ui/src/primitives/*`;
  product-client/product-surfaces/product-ui have no radix deps in their
  package.json) — zero allowlist entries added, none needed.
- `UI_SRC_TOP_LEVEL_ENTRY`: `apps/packages/ui/src` may contain only
  `primitives/`, `patterns/`, `icons/`, `lib/`, `utils/`, `overlays/` at its top
  level (`UI_SRC_ALLOWED_TOP_LEVEL_ENTRIES`, enumerated from the actual tree
  post step-6: `ls apps/packages/ui/src` showed exactly these six dirs, no
  loose top-level files). New `find_ui_src_top_level_violations()` lists
  `UI_SRC.iterdir()` and fails any entry not in the allowlist, pointing at
  `specs/codebase/structures/frontend/packages/README.md` (the component-library
  taxonomy doc) in the message. No `kit/DropdownMenu` ban added — out of scope
  per task brief, that migration still has consumers.

Test coverage: new `scripts/test_check_frontend_boundaries.py` (first test file
for this checker), following the `test_check_docs.py`/`test_check_appearance_scaling.py`
pattern of `tempfile.TemporaryDirectory()` + `patch.object(module, ...)` on the
module's root constants. 6 tests: radix-allowed-under-primitives-and-patterns,
radix-violation-with-two-distinct-paths, radix-ignored-in-line-comments,
ui-src-top-level-all-allowed-passes, ui-src-top-level-unexpected-entry-fails,
ui-src-missing-directory-is-a-no-op (mirrors the `should_skip`/generated-prefix
no-op conventions elsewhere in this checker family). Wired into
`.github/workflows/ci.yml`'s "Check frontend layer boundaries" step (ran before
the checker itself, same order as the appearance-scaling step's
test-then-check pattern).

JC: `iter_frontend_files()` (desktop + product-client only) was too narrow for
a package-dependency-containment rule that must also catch violations in `ui`,
`product-ui`, `product-surfaces`, `web`, `mobile`, `design`, `product-domain` —
added a general `iter_files_in_roots()`/`ALL_FRONTEND_SRC_ROOTS` alongside it
rather than widening the existing desktop/product-client-scoped function (which
backs the desktop-specific access/query-cache rules and must stay scoped to
those two trees).

Gates (this step): `python3 scripts/check_frontend_boundaries.py` exit 0 (zero
violations, zero allowlist entries — confirms the radix rule finds nothing to
grandfather). `python3 -m unittest scripts/test_check_frontend_boundaries.py`
6/6 OK. `python3 scripts/check_docs.py` exit 0 (224 files, unaffected — no
specs/ or markdown changes this step). `python3 scripts/check_appearance_scaling.py`
exit 0 (unaffected — no design/appearance-scaling-relevant source touched).

## Step 8 notes

Authored `specs/codebase/platforms/product/component-library.md` as the
canonical current-state doc for the component library: tier model
(`ui/src/{primitives,patterns,icons}` + `product-ui/src/patterns` for
domain-aware compositions), the governance rule (no raw Radix outside the
library, no hardcoded style values, no re-implemented library behavior,
graduation-into-library trigger), the sanctioned index (71 rows: 34
primitives, 22 patterns, 4 icon sets, 11 product-ui domain-aware patterns —
paths verified against `git ls-files` of the real tree, not the catalog's
stale pre-move paths), "How to add a component," failure modes, and current
gaps. Cross-links to `design-system.md` and `packages/README.md`; added a
one-line pointer back from `design-system.md`'s "Does not own" list
(`per-component anatomy` line) — the only edit outside this file + this
progress file.

JC: the catalog source (`catalog-v2-snapshot.md`) is a decision/ruling sheet
full of D-numbers, RULED/BLOCKED verdicts, importer-count tables, and a kill
list — none of that framing survives. The new doc states only what the
codebase looks like today: which tier a component is in, its real path, and
a one-line purpose (reusing the catalog's purpose prose where accurate,
discarding its movability/ruling apparatus entirely).

JC: `checkbox-primitive`/`Checkbox` and `tooltip-primitive`/`Tooltip` are
documented as "Collision pairs (transitional)" with both files getting their
own index row (not merged into one row) — each is independently exported and
independently importable today, so collapsing them into a single row would
misstate the sanctioned index as a closed set of *exports*, which it is.

JC: `DropdownMenu` gets a normal primitives-table row (raw Radix wrapper,
same as `Dialog`/`Popover`/etc.) plus a separate "DropdownMenu status"
paragraph naming its exact 4 grandfathered consumers (re-verified by grep:
`WorkspaceItemMenu.tsx`, `RightPanelNewTabMenu.tsx`,
`WorkspaceActionsMenu.tsx`, `ProposedPlanCard.tsx` — same 4 files the catalog
named, unchanged since). Phrased factually ("legacy menu system alongside
PopoverButton/PopoverMenuItem; migration pending," Radix parity gap named as
the reason) with no ban language — `check_frontend_boundaries.py` has no
`DropdownMenu`-specific gate (step 7 explicitly left it out of scope), so a
ban claim would be false.

JC: `popover-surface.ts` (the dependency-free `POPOVER_FRAME_CLASS`/
`POPOVER_SURFACE_CLASS` leaf `PopoverButton`/`Popover`/`DropdownMenu` all
import) is infrastructure a primitive composes, not itself a component with
a public export subpath — no `package.json` `exports` entry exists for it,
so it gets no index row, consistent with the "every row has an export
subpath" closed-set rule stated at the top of the index. Same reasoning for
`lib/utils.ts` and the `utils/*`/`overlays/*` files: infra, not components,
called out by name in the "Where The Library Lives" tree instead of getting
table rows.

JC: `product-ui/src/patterns/secrets/`'s five internal files
(`SecretDeleteDialog`, `SecretEditorDialog`(+test), `SecretList`,
`SecretRow`, `SecretScopeNotice`) get no index rows — confirmed via step 6's
own notes and a fresh `package.json` exports check that only
`secrets/SecretManagementPanel` has an export subpath; the five are unexported
private implementation detail of that one pattern, so by the same
export-subpath-gates-a-row rule they're correctly absent, not an oversight.

JC: did not add a "Component library" row to `platforms/product/README.md`'s
Platform Map table. The task brief's list of allowed edits ("your new file +
progress.md" plus the one design-system.md pointer) doesn't name the
platform-map index; adding an unlisted edit there would exceed the brief's
edit-scope contract even though `check_docs.py` has no rule requiring every
platform doc to appear in that table (verified — no such check exists). Left
as a gap for whoever reviews/lands this: the doc exists and is linked from
`design-system.md`, but is not yet listed in the Platform Map table.

Gates (this step): `python3 scripts/check_docs.py` exit 0 (225 files, +1 from
this step's new doc). `PYTHONPATH=. python3 -m scripts.test_check_docs` 17/17
OK. `python3 scripts/check_frontend_boundaries.py` exit 0 (docs-only step,
unaffected). No source files touched, so no typecheck/vitest run needed this
step.

- [x] 8. component-library.md spec (D)
- [ ] 9. adversarial verify + fixes (V)
- [ ] 10. delete .taxonomy-plan, final gates
