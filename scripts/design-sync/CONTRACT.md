# Design-sync builder — shared contract

Builds the claude.ai Claude Design payload from the LIVE library registry. Upload target (ruled by Pablo 2026-08-12): a NEW design-system project created at upload time — the existing "Proliferate" project `b43f2bbd-6915-4172-af69-6b6e7fca0484` must NOT be written to or deleted from; it stays as the rollback until the new project is validated. Reference payload (the old, working artifact — READ-ONLY ground truth for every format question): `/Users/pablohansen/Downloads/claude-design-reference-payloads/proliferate-ui`.

Output directory: `scripts/design-sync/.out/` (gitignored). All scripts are Node ESM (`.mjs`), run with the repo's Node 22, no new npm installs — every tool needed is already in the workspace (see "Tooling" below).

## Payload contract (must match the reference payload exactly unless noted)

Top level: `_ds_bundle.js`, `_ds_bundle.css`, `_ds_needs_recompile` (exact 24 bytes: `{"by":"design-sync-cli"}`), `_ds_sync.json`, `.ds-build-meta.json`, `README.md`, `styles.css` (exactly: `@import "./fonts/fonts.css";` newline `@import "./_ds_bundle.css";`), `_vendor/react.js` + `_vendor/react-dom.js` (stub, exact content `/* merged into react.js */`), `fonts/` (woff2 + fonts.css with flat `url(./file.woff2)` paths), `guidelines/working-agreement.md` (the design agent's working agreement — closed vocabulary, deviation declarations, handoff-manifest format; generated from `templates/guidelines.md.tmpl`, its authoring twin lives at `~/agent-engineering/nodes/implement-design-handoff/`), `_preview/<Name>.js` per entry, `components/<group>/<Name>/` per entry holding `<Name>.html`, `<Name>.light.html`, `<Name>.jsx`, `<Name>.prompt.md` (and `<Name>.d.ts` if step 5's tsc pass works out). QA artifacts (not uploaded-critical, but built): `.render-check.json`, `.review.html`, `_screenshots/`.

### Card HTML
Every entry emits TWO cards from the same template, the same `_preview/<Name>.js` and the same `MODE`/`PRIMARY`: `<Name>.html` (dark, the default) and `<Name>.light.html`, which differs only by `data-mode="light"` on `<html>` — where the token authority scopes its light palette (`:root[data-mode="light"]`) — and by a ` (light)` suffix on its `@dsCard group`, so the picker keeps the two modes as sibling sections instead of interleaving them. Render-check therefore gates `2 × entries` cards (174 today), and every light screenshot must differ from its dark twin (identical bytes = the mode attribute stopped taking effect).

First line: `<!-- @dsCard group="<group>" -->` for grid cards, `<!-- @dsCard group="<group>" viewport="900x700" -->` for single/column cards. Then the exact boilerplate of the reference card (copy from e.g. `components/primitives/Button/Button.html`), substituting only: the two `<script src>` lines for `_preview/<Name>.js`, and the inline `var MODE="grid|single|column"; var PRIMARY="<story-or-empty>";`. Load order: styles.css + _ds_bundle.css stylesheets → _vendor/react.js → _vendor/react-dom.js → _ds_bundle.js → _preview/<Name>.js → inline bootstrap (copy verbatim from reference). The bootstrap collects PascalCase function props of `window.__dsPreview` and mounts them with `ReactDOM.createRoot`.

### Preview modules — SIMPLIFIED vs the old build
`_preview/<Name>.js` is now trivial static JS (no per-preview bundling):
```js
var __dsPreview = { Demo: (window.ProliferateUI.__demos || {})["<entry.name>"] };
```
This satisfies the bootstrap (one PascalCase key `Demo`). The demo components live inside the main bundle.

### React MUST be external to `_ds_bundle.js`
Two React copies break hooks. `_ds_bundle.js` must resolve `react`, `react-dom`, `react-dom/client`, `react/jsx-runtime` (and `react/jsx-dev-runtime`) to shims reading `window.React` / `window.ReactDOM` (jsx-runtime shim implements `jsx`/`jsxs`/`Fragment` over `window.React.createElement` — see the tail of any reference `_preview/*.js` for the exact working shim semantics). `_vendor/react.js` is built from the repo's react@19.2.8 + react-dom + react-dom/client as one IIFE that assigns `window.React` (with createElement etc.) and `window.ReactDOM` (with `createRoot`). End it the way the reference does (assign + cleanup temp globals).

### `_ds_bundle.js`
Vite lib-mode IIFE, global name `ProliferateUI`, entry = generated `.ds-entry.tsx`. First line must be a single-line comment: `/* @ds-bundle: {"namespace":"ProliferateUI","components":[{"name","sourcePath"}...],"sourceHashes":{...},"inlinedExternals":[],"builtBy":"proliferate-design-sync"} */` (sourcePath = the payload-relative `components/<group>/<Name>/<Name>.jsx`). The IIFE result lands on `window.ProliferateUI` and must expose: every library export (see barrel below) plus `__demos` (entry.name → React component wrapping the registry demo: `() => entry.render()`) and `__tiers` (JSON-safe `[{id, title, entries: [{name, subpath, group}]}]`).

### `_ds_sync.json` (our recipe — internal consistency only; only sync tooling reads it)
```
{ shape: "registry", styleSha: sha256(_ds_bundle.css),
  renderHashes: { name -> sha256_16(demo-relevant source) },
  sourceKeys:   { name -> sha256_16(component source files) },
  keyRecipe: 8, scriptsSha: sha256_16(concat of scripts/design-sync/**.mjs + templates/* + css/*),
  sourceHashes: { "components/<g>/<N>/<N>.jsx" -> sha256_12, ...(.prompt.md, .d.ts if present) },
  auxSha: sha256_16(README+styles+fonts.css), bundleSha12: sha256_12(_ds_bundle.js) }
```

## Registry facts (the manifest)
`apps/packages/product-client/src/components/playground/library/index.tsx` exports `LIBRARY_TIERS: LibraryTier[]` — 4 tiers, **87 entries** total (37 primitives, 37 patterns, 10 icon modules, 3 product-patterns), each `{name, subpath, render}`. Demos are self-contained (useState fine, no providers/stores). Names are unique and include lowercase ones (`checkbox-primitive`, `tooltip-primitive`, icon module names like `core`, `app-shell`) and one tier-relative one (`secrets/SecretManagementPanel`).

The tier arrays are **composed**, not literal: entries are spread in from `library/entries/*.tsx` (one demo per file) and the kit demo files (`tabs.tsx`, `panel.tsx`) as well as declared inline in `primitives.tsx` / `patterns.tsx` / `icons.tsx` / `product-patterns.tsx`. `library-registry.test.ts` is the registry's own parity gate (every physical primitive/pattern/icon/domain-pattern owner has exactly one row).

### The registry is EVALUATED, never parsed
`dump-registry.mjs` compiles `LIBRARY_TIERS` with the same Vite machinery `build-bundle.mjs` uses (`#product/` → `product-client/src`, react deduped) as a node-format SSR build into a scratch dir under `product-client/node_modules/`, imports it in-process, and writes `.out/.ds-registry-manifest.json` = `[{tierId, tierTitle, name, subpath}]` in tier order. Renders are never executed (only names/subpaths/tier metadata are read), and the scratch dir is deleted after the import.

`registry-manifest.mjs` loads that JSON (dumping lazily if it's absent) and decorates each entry with `displayName`, `group`, `mode`, `primary` and `srcFile`; it is the ONE place `groupFor`/`modeFor`/`displayNameOf` live. `make-entry.mjs`, `build-bundle.mjs`, `emit-cards.mjs` and `make-meta.mjs` all consume that decorated list — no script re-derives the registry from source text.

**Gates** (all hard failures): exactly the 4 declared tiers, each non-empty; every entry name unique across tiers; every subpath resolves to an existing `src/**.tsx`; every group in the allowed set; and `EXPECTED_TOTAL` in `registry-manifest.mjs` (87 today) matched exactly — the deliberate drift tripwire that replaced the old per-tier counts. Bump it on purpose when the registry changes, and re-sync.

### Groups (kit-aware, ruled)
Group per entry, rule order:
1. subpath matches `#product/primitives/patterns/<kit>/…` → `<kit>`, asserted against the closed kit set `{composer, toast, sidebar, tabs, panel, settings}` (an unknown pattern subdirectory is a hard failure, not a new group)
2. else by name: starts with `Composer` or is `LevelBarsButton` → `composer`; is `ToastHost`/`Sonner` or starts with `Toast` → `toast`; starts with `Sidebar` → `sidebar`; starts with `Settings` → `settings`
3. else tier id: primitives → `primitives`, patterns → `patterns`, icons → `icons`, product-patterns → `product-patterns`

Display name (card dir, file names, group matching) is `name.split("/").pop()`; the raw name stays the `__demos` key. Kit membership follows the file, so `secrets/SecretManagementPanel` (under `components/patterns/`, not `primitives/patterns/`) stays in `product-patterns` and lands at `components/product-patterns/SecretManagementPanel/`.

### Purposes
`<Name>.prompt.md` purpose comes from `specs/DESIGN_SYSTEM.md` § "The sanctioned index" (four `####` sub-tables, matched on the registry name or its display name). A name with no row falls back to the source file's leading JSDoc sentence; an entry with neither is a HARD build failure listing the offenders — there is no placeholder purpose.

### Card modes
Defaults: `grid`. Overrides (intersect with actual registry names; `single` implies `PRIMARY="Demo"` and viewport 900x700; `column` implies viewport 900x700):
- `single`: Dialog, AlertDialog, ModalShell, ConfirmationDialog, CommandPalette, Popover, PopoverButton, DropdownMenu, SettingsMenu, EnvironmentSearchSelect, PickerPopoverContent, FixedPositionLayer, ToastHost, Sonner (whichever exist in the registry)
- `column`: ModelTable, ProductPageShell, SettingsPageHeader, PageContentFrame, SettingsRow, SettingsSaveFooter, SettingsScopeTabs, SettingsSection, SettingsEmptyState, AutoHideScrollArea, ComposerControlButton, ComposerTextarea, ComposerTextareaFrame, PageHeader, PaneOptionsMenuItem, ThinkingText, AnimatedCollapsibleContent, AnimatedSwapText, Command, PopoverMenuItem, RangeSlider, RowActionIconButton, Switch, Tooltip, SecretManagementPanel, BillingGateState, PrStatusBadge (whichever exist)

## Build-from-live-source facts
- `#product/*` must be aliased to `apps/packages/product-client/src/*` (Node semantics resolve it to missing `dist/`): Vite `resolve.alias: [{ find: /^#product\//, replacement: "<abs>/src/" }]` + `dedupe: ["react","react-dom"]` (copy vitest.config.ts's pattern).
- Workspace runtime dep of the library subtree: only `@proliferate/design/motion` → requires `pnpm --filter @proliferate/design build` first (tsc + node scripts; cheap). The orchestrator runs it; scripts may assert `apps/packages/design/dist/motion.js` exists.
- CSS: compile FROM `apps/packages/design/dist/css/product.css` (its `@import "../theme.css"` and Geist font paths only resolve in dist; its `@source` already scans live product-client/src). Wrap in a `ds-source.css` that adds: (1) `html, html body { background: var(--color-background); color: var(--color-foreground); }` (dark-first tokens + transparent body = white-on-white without it), (2) a generated utility safelist via `@source inline(...)` (spacing/sizing/flex/grid/typography scales + every color role as `{bg,text,border,ring}-<role>` and `hover:` variants, generated from the token authority `apps/packages/design/dist/theme.css` / `src/tokens.ts` — do not hand-copy), (3) `@source "./safelist-extra.txt"` for fractional classes (`gap-1.5` etc. — `@source inline()` can't hold dots).
- Fonts: Inter/Manrope variable woff2 from `apps/packages/design/node_modules/@fontsource-variable/{inter,manrope}/files/` (subset files), Geist/GeistMono from `apps/packages/design/dist/fonts/`. Emit flat `fonts/fonts.css` with `@font-face` + `url(./<file>)` (mirror the LIVE half of the reference `fonts/fonts.css`).

## Tooling available WITHOUT installs (pnpm install is running; wait for `node_modules/.bin/vite` in product-client before executing builds)
- `vite@6` + `@vitejs/plugin-react`: devDeps of `apps/packages/product-client` (bins in its `node_modules/.bin` after install).
- `tailwindcss@4.3.3` (+oxide native): dependency of `apps/packages/design`. `@tailwindcss/vite` resolvable from `apps/web`. Either compile CSS via a one-entry Vite build (cwd apps/web) or the `tailwindcss` Node API.
- esbuild: transitively via vite (`import esbuild from "esbuild"` may not resolve — prefer `vite.build` or `(await import("vite")).transformWithEsbuild` for the .jsx transforms).
- React 19.2.8 at `apps/packages/product-client/node_modules/react`.

## Doctrine source of truth (updated 2026-08-12, post wave-2 restructure)
The branch carries the merged component-hierarchy doctrine (#1779), the wave-2 vocabulary work (#1806 retirements) and the kit moves. All README/prompt.md/guideline text derives from THIS tree's `specs/DESIGN_SYSTEM.md` § Component Library — never from memory or an earlier snapshot. Notable current facts: the jobs table is FIVE jobs (paint/anatomy/state/layout/behavior); the kit set is closed (composer/toast/sidebar/tabs/panel/settings) and kit members live under `primitives/patterns/<kit>/`; noun-tier admission is mechanical; `DropdownMenu` is the sanctioned keyboard-menu path (the `PopoverButton` pair is click-only); the sanctioned index includes ToastBody/ToastExpansion/ToastHost/BillingGateState (ToastBody/ToastExpansion are sanctioned but deliberately out of the registry). The kit moves have LANDED: card groups now come from the subpath's kit directory first and the entry name second, and the entry list is evaluated from `LIBRARY_TIERS` (never hardcoded, never regex-parsed), so further moves flow through untouched. Keep keyRecipe stable so re-syncs are cheap deltas.

## Machine rules for every agent
NO cargo/rustc builds. NO Docker. NO `pnpm install` (the orchestrator runs the single install). At most one headless browser. Do not touch files owned by another stream (ownership in each agent brief). Do not spawn subagents.
