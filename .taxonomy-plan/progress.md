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

Steps:
- [x] 1. Plan committed
- [x] 2. git mv per moves.tsv (pure renames, no content edits)
- [x] 3. ui-internal wiring: relative imports, exports map, tsup/tsconfig/vitest paths; ui builds green
- [x] 4. external consumers: product-ui/product-surfaces/product-client/apps rewrites + tailwind @source globs; shared:typecheck green
- [ ] 5. specs/ links + appearance-baseline key renames; check_docs + appearance + boundaries green
- [ ] 6. product-ui patterns/ grouping (M2)
- [ ] 7. boundary gate rules (G)
- [ ] 8. component-library.md spec (D)
- [ ] 9. adversarial verify + fixes (V)
- [ ] 10. delete .taxonomy-plan, final gates
