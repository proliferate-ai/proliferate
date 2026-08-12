# Design-sync builder — shared contract

Builds the claude.ai Claude Design payload from the LIVE library registry. Upload target (ruled by Pablo 2026-08-12): a NEW design-system project created at upload time — the existing "Proliferate" project `b43f2bbd-6915-4172-af69-6b6e7fca0484` must NOT be written to or deleted from; it stays as the rollback until the new project is validated. Reference payload (the old, working artifact — READ-ONLY ground truth for every format question): `/Users/pablohansen/Downloads/claude-design-reference-payloads/proliferate-ui`.

Output directory: `scripts/design-sync/.out/` (gitignored). All scripts are Node ESM (`.mjs`), run with the repo's Node 22, no new npm installs — every tool needed is already in the workspace (see "Tooling" below).

## Payload contract (must match the reference payload exactly unless noted)

Top level: `_ds_bundle.js`, `_ds_bundle.css`, `_ds_needs_recompile` (exact 24 bytes: `{"by":"design-sync-cli"}`), `_ds_sync.json`, `.ds-build-meta.json`, `README.md`, `styles.css` (exactly: `@import "./fonts/fonts.css";` newline `@import "./_ds_bundle.css";`), `_vendor/react.js` + `_vendor/react-dom.js` (stub, exact content `/* merged into react.js */`), `fonts/` (woff2 + fonts.css with flat `url(./file.woff2)` paths), `_preview/<Name>.js` per entry, `components/<group>/<Name>/` per entry holding `<Name>.html`, `<Name>.jsx`, `<Name>.prompt.md` (and `<Name>.d.ts` if step 5's tsc pass works out). QA artifacts (not uploaded-critical, but built): `.render-check.json`, `.review.html`, `_screenshots/`.

### Card HTML
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
`apps/packages/product-client/src/components/playground/library/index.tsx` exports `LIBRARY_TIERS: LibraryTier[]` — 4 tiers, 81 entries total (36 primitives, 24 patterns, 10 icon modules, 11 product-patterns), each `{name, subpath, render}`. Demos are self-contained (useState fine, no providers/stores). Names are unique and include lowercase ones (`checkbox-primitive`, `tooltip-primitive`, icon module names like `core`, `app-shell`).

### Groups (kit-aware, ruled)
Group per entry, derived from `entry.name` first, else tier:
- name starts with `Composer` or is `LevelBarsButton` → `composer`
- name is `ToastHost` or `Sonner` or starts with `Toast` → `toast`
- name starts with `Sidebar` → `sidebar`
- name starts with `Settings` → `settings`
- else tier id: primitives → `primitives`, patterns → `patterns`, icons → `icons`, product-patterns → `product-patterns`

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

## Doctrine source of truth (updated 2026-08-12, post PR #1779 merge)
The worktree branch is fast-forwarded to main @ 9cfa80c73, which contains the merged component-hierarchy doctrine. All README/prompt.md/guideline text derives from THIS tree's `specs/DESIGN_SYSTEM.md` § Component Library — never from memory or an earlier snapshot. Notable current facts: the jobs table is FIVE jobs (paint/anatomy/state/layout/behavior); the kit set is closed (composer/toast/sidebar/tabs/panel/settings); noun-tier admission is mechanical; `DropdownMenu` is the sanctioned keyboard-menu path (the `PopoverButton` pair is click-only); the sanctioned index includes ToastBody/ToastExpansion/ToastHost/BillingGateState. Kit-move PRs (composer/toast/sidebar, later settings, into `primitives/patterns/<kit>/` subdirs) are in flight on main: derive card groups from entry NAME (never file paths) and read subpaths from LIBRARY_TIERS/registry files at build time (never hardcode), so the payload builder survives those moves; keep keyRecipe stable so post-move re-syncs are cheap deltas.

## Machine rules for every agent
NO cargo/rustc builds. NO Docker. NO `pnpm install` (the orchestrator runs the single install). At most one headless browser. Do not touch files owned by another stream (ownership in each agent brief). Do not spawn subagents.
