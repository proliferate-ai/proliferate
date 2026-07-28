# design-sync notes

## Shape

- **Shape is `package`**, not `storybook`. Verified 2026-07-27: no
  `.storybook/` directory and zero `*.stories.*` files anywhere outside
  `node_modules`. Storybook (the tool) is not used in this repo.
- **But there IS a Storybook-equivalent**: the in-app *playground*, and
  specifically its component-library spec sheet. Do not treat the
  package shape here as "no usage examples exist" — see below.

## The playground library registry (preview-authoring source)

`apps/packages/product-client/src/components/playground/library/` is a
CI-enforced registry of every sanctioned component, and it is the right
source for authored previews:

- `types.tsx` — `LibraryEntry { name, subpath, render: () => ReactNode }`
  and `LibraryTier { id, title, entries }`.
- Tiers: `primitives.tsx` (34), `patterns.tsx` (22), `icons.tsx` (4),
  `product-patterns.tsx` (11) — **72 entries total**, composed by
  `index.tsx` as `LIBRARY_TIERS`.
- `subpath` is the exact `package.json` `exports` key of the owning
  package, and `library-registry.test.ts` fails CI if a sanctioned export
  drifts out of sync. Each entry's `render()` is a real working usage
  example — **port these rather than inventing compositions.**
- Rendered by `PlaygroundLibrary.tsx` at `/playground/library` under the
  real theme, with a light/dark toggle via `useColorMode`.
- Note the registry treats icons as a **tier with 4 representative
  entries**, not one entry per icon — the card-set decision below follows
  that same judgment.

## Scope: two packages, one synthesized entry

The sanctioned surface spans `@proliferate/ui` (`apps/packages/ui`) and
`@proliferate/product-ui` (`apps/packages/product-ui`); tokens live in
`@proliferate/design`. All three build from the repo root with
`pnpm -F "@proliferate/product-ui..." build` (the trailing `...` is
required — it pulls in design + product-domain + the SDKs).

**Neither UI package declares `exports["."]`, `main`, or `module`** —
both are subpath-only (65 and 73 exports). The converter needs one entry,
so `.design-sync/make-entries.mjs` (committed) synthesizes:

- `apps/packages/<pkg>/.ds-entry.mjs` — runtime barrel per package. The
  `ui` one also re-exports `../product-ui/.ds-entry.mjs`, so **one entry
  backs the whole surface**. Routing product-ui through `extraEntries`
  instead makes the converter see the same 79 names twice and warn
  `[EXPORT_COLLISION]` — don't do that.
- `apps/packages/ui/index.d.ts` — the **type** barrel. The converter
  resolves the type entry as `pkgJson.types` falling back to
  `<pkgDir>/index.d.ts`; neither package sets `types`, so without this
  file component discovery finds **zero** components.

Three in-package name collisions are pinned explicitly (ESM silently
drops ambiguous `export *` names), named the way the registry names them:
`Checkbox`/`CheckboxPrimitive`, `Tooltip`/`TooltipPrimitive`, `Spinner`
(the `primitives/Spinner` one wins over the icon). Zero cross-package
collisions — verified.

All generated entries are gitignored; the generator is committed. Re-run
it after any build: it is part of `cfg.buildCmd`.

## Gotchas that cost a cycle

- **`dist/` is bundler-resolution output** (`tsc` emits extensionless
  relative imports like `./core`). It is NOT loadable by plain Node ESM —
  a `node -e "import(...)"` sanity check fails with `ERR_MODULE_NOT_FOUND`
  even when the barrel is correct. Verify with esbuild instead; that is
  what the converter uses.
- **`package-build.mjs` resolves `--entry` and `--node-modules` against
  the CWD**, not the package. Relative paths silently produce
  `[NO_DIST]` + `[DTS_REACT]` even when both targets exist. **Pass
  absolute paths.**
- **`cssEntry` is package-bounded** — a path outside `apps/packages/ui`
  is skipped with `! cssEntry: … resolves outside the package`, which
  then cascades to a misleading `[CSS_RUNTIME]`. The compiled stylesheet
  is therefore written to `apps/packages/ui/.ds-compiled.css`
  (gitignored). `extraFonts` has a wider bound (the git repo), so it can
  reach `.design-sync/css/` and the design package's `node_modules`.

## CSS: product.css is a source file, not compiled output

`@proliferate/design/product.css` is Tailwind **v4 source** (`@import
"tailwindcss"`, `@source`, `@utility`) — pointing `cssEntry` at it ships
no utilities and every preview renders unstyled. `.design-sync/css/
ds-source.css` (committed) mirrors `apps/web/src/index.css` but `@source`s
only the two DS packages; it compiles with the Tailwind CLI pinned to the
repo's own **4.3.3** into `apps/packages/ui/.ds-compiled.css` (~273 KB).
That step is in `cfg.buildCmd`.

Verified present in the compiled output: `bg-surface-elevated`,
`text-ui-sm`, `border-border`, `text-foreground`, `bg-background`,
`icon-paired`, `text-heading`, plus `--color-*` / `--text-*` token values
(276 live tokens per the design package's own `check-theme`).

## Fonts

- Inter Variable and Manrope Variable ship via `extraFonts` pointed at the
  `@fontsource-variable/*` packages' `index.css` (the converter parses
  them and copies the woff2s into `fonts/`).
- **Geist / Geist Mono needed a hand-authored `@font-face`**:
  product.css declares them with absolute `/node_modules/geist/...` URLs
  that a bundle cannot resolve, so the rules shipped dangling and mono
  text fell back to a system font. `.design-sync/css/geist.css`
  (committed) redeclares both families with resolvable relative paths and
  is wired through `extraFonts`. Copying the woff2 alone is NOT enough —
  the build log says so explicitly ("add a matching @font-face").
- Result: 45 `@font-face` rules, 15 urls rewritten into `fonts/`.

### The dark-first root surface (found by the Button calibration)

**This is the single most important fix in this sync.** The DS is
dark-first: `theme.css` puts dark values on `:root` and flips to light
under `:root[data-mode="light"]`. But:

- `product.css` sets `body { background: var(--color-background) }` early
  and then a LATER rule in the same file resets `html, body` to
  `background: transparent` — in the real app the shell (`#root`) paints
  the surface.
- The converter's preview-card template hardcodes
  `body{margin:0;padding:24px;background:#fff}` in the card's own inline
  `<style>`.

Net effect before the fix: cards rendered on **white** while the tokens
stayed **dark**, so `--color-primary` (`#ffffff` in dark mode) drew a
white primary button on a white page. Primary/default-variant controls
were **invisible** — and `[RENDER_THIN]` does not reliably catch it,
because the text nodes are present. Secondary and destructive rendered
fine, which is what makes it so easy to miss.

Fix lives at the end of `.design-sync/css/ds-source.css`: an
`html, html body` rule painting `--color-background` /
`--color-foreground`. The compound `html body` selector is deliberate —
specificity (0,0,2) beats the card's inline `body` rule (0,0,1) without
forking `lib/emit.mjs`, which the skill forbids because it defines the
app's output contract.

**Any future preview that looks unstyled: check this rule survived the
Tailwind compile before debugging the component.**

### Designs render from STATIC css — hence the safelist

Second structural finding, as consequential as the dark surface. Tailwind
only emits a utility it actually sees in a scanned source, so a bundle
compiled from the DS packages alone carries **only the classes the DS
itself happens to use**. Verified missing before the fix: `gap-12`,
`text-2xl`, `grid-cols-3`, `mt-16`, `icon-tight` — all things a design
agent composing new layout writes constantly. There is no error path:
the class simply does nothing and the design is silently mis-laid-out.

`.design-sync/css/ds-source.css` therefore ends with an `@source
inline(...)` safelist covering the standard spacing/sizing/layout/type
scales plus the DS's own semantic roles, generated from the token
authority (126 `--color-*` roles, 17 `--text-*` scales). Compiled CSS
grows 273 KB → 485 KB; that is the correct trade.

**The DS resets Tailwind's defaults.** `theme.css` opens with
`--color-*: initial; --text-*: initial`, which wipes Tailwind's stock
palette and type ramp. So:

- `text-2xl` / `text-sm` / `bg-slate-500` **do not exist in this DS** and
  are correctly absent from the compiled CSS — do not "fix" that.
- The only type scales are the DS's 17: `text-body`, `text-body-emphasis`,
  `text-chat`, `text-chat-meta`, `text-composer`, `text-heading`,
  `text-hero`, `text-markdown-inline-code`, `text-message`,
  `text-readable-code`, `text-sidebar-brand`, `text-sidebar-nav`,
  `text-sidebar-row`, `text-title`, `text-ui`, `text-ui-sm`,
  `text-workspace-title`.
- Colour utilities take the semantic role names only (`bg-surface-elevated`,
  `text-muted-foreground`, `border-border`, …).

This is the single most important thing the conventions header must
teach the design agent.

### Safelist mechanics: two traps

- **`@source inline(...)` cannot express fractional steps.** The `.` in
  `0.5` breaks its parsing, so `gap-1.5`, `px-0.5`, `p-2.5` etc. silently
  fail to emit while integer steps from the *same* brace list emit fine.
  Fix: `.design-sync/css/safelist-extra.txt`, a plain-text file of class
  names pulled in with `@source "./safelist-extra.txt"` — Tailwind
  extracts class-like tokens from any scanned source. 127 fractional
  rules now emit.
- **Verifying a class in the compiled CSS needs the right escaping.** The
  class `gap-0.5` is written `.gap-0\.5` in CSS. A naive
  `grep -c "\.gap-0\.5"` matches nothing and reads as "missing" even when
  the rule is present — this cost a wrong conclusion once. Use
  `grep -c "\.gap-0\\\\\.5"`.
- **Arbitrary values (`w-[520px]`, `ring-[0.5px]`) can never work** in a
  static bundle: nothing scans the design agent's output, so they emit
  nothing. Previews must compose from safelisted steps only. Largest
  safelisted height is `h-96`.

### DS defect found while grading: `Badge tone="warning"` is unreadable

Not a preview problem — a real bug in the shipped system.
[Badge.tsx](../apps/packages/ui/src/primitives/Badge.tsx) renders the
warning tone as `border-warning/30 bg-warning/10 text-warning`, but in
dark mode `--color-warning` is `rgba(255, 180, 50, 0.15)` — an alpha
*fill* value. Used as ink via `text-warning` it renders the label at 15%
opacity, i.e. an effectively empty pill. The ink token is
`--color-warning-foreground` (`#ffb432`). Every other tone reads fine
because those tokens are opaque hexes.

Fix belongs in `Badge.tsx` (or the token) — **not** in a preview. The
Badge `Tones` cell deliberately still shows it so the defect stays
visible instead of being papered over with a substituted tone.

**Confirmed independently three times** (my own Badge grade, batch E on
SettingsRow/SettingsSaveFooter, batch F on three billing/repo surfaces),
and it is not cosmetic-only: it reaches real product states. Batch F
recorded that **`BillingOwnerCard`'s start-blocked plan state cannot be
photographed legibly until the token is fixed** — the same is true of
`BillingSettingsPane` with `checkoutReturnState="cancel"` and
`CloudRepoPicker`'s `disabledReason`/archived rows. Those cells were
reworked onto readable tones so the sheets show the component rather
than the bug, with the limitation recorded in each grade note. Any
warning-toned state in the product has this problem today.

### Reveal-on-hover traps (previews photograph blank without these)

- `SidebarActionButton` defaults to `visibility="hover"` (`opacity-0` at
  rest) — pass `alwaysVisible` or `variant="section"`.
- `SidebarNavRow`'s `shortcutLabel` is `opacity-0` unless
  `shortcutRevealVisible` is also passed.
- `Tooltip`'s bubble is structurally uncapturable: its API is
  `{content, children, className, singleLine}` with no `open`/`defaultOpen`,
  the trigger is an internal `<span>`, and the capture harness performs no
  hover step. Its cells verify trigger surfaces only; `TooltipPrimitive`
  (Radix, accepts `defaultOpen`) is the export to preview if the bubble
  itself needs coverage.

### The generated `.d.ts` under-reports props

Repeatedly observed: required handlers are missing from the emitted type
(`onToggle` on ModelTable, `onSave`/`onRevert` on SettingsSaveFooter,
`onChange` on SettingsScopeTabs), and row types like `ModelTableRow` are
never emitted. **The playground registry's `render()` is the accurate
contract; the `.d.ts` is a hint.** Read the component source for anything
with a callback or a row/item type.

### Known render warns (triaged as legitimate — a warn NOT listed here is new)

- `[FONT_MISSING] "Manrope"` — benign. Bare `Manrope` appears only as a
  fallback inside `font-family: 'Manrope Variable',Manrope,sans-serif`;
  `Manrope Variable` itself ships 12 `@font-face` rules. Nothing to fix.
- `[TOKENS_MISSING]` for `--diffs-column-number-width`,
  `--compute-target-color`, `--git-new-line-bg`, `--git-removed-line-bg`,
  `--tw` — set at runtime by components (inline style / JS), which the
  validator documents as expected.
- `[DTS_STYLE_SYSTEM] filtering @types/react props` — informational.

## Card set: 184, not 341

The converter discovered 341 components; **157 of them are individual
icons** that render as blank/thin cards (SVGs with no size or color of
their own) and would drown the ~70 real components in the picker. They
are excluded from the card set via `componentSrcMap` nulls and **remain
fully importable** — `window.ProliferateUI` still exposes all 374
exports (spot-checked: `Home`, `GitHub`, `ArrowDown`, `Sparkles`,
`Palette`). This mirrors the registry's own treatment of icons as a
4-entry tier.

## Toolchain pins

- pnpm, Node v22.22.2 (`.nvmrc`). Install: `pnpm i --frozen-lockfile`
  (~30 s). `COREPACK_ENABLE_STRICT=0` avoids corepack self-provisioning.
- **playwright 1.56.0** for the render check — NOT the repo's own pin
  (1.61.1). The pre-installed chromium at `PLAYWRIGHT_BROWSERS_PATH=
  /opt/pw-browsers` is build **1194**, which 1.56.0 pins; 1.61.1 pins
  1228 and fails with `Executable doesn't exist`.
- Tailwind CLI **4.3.3**, matching the repo's `tailwindcss` version.

## Status / where this stopped

Build and `package-validate.mjs` are clean (exit 0, 5 non-blocking warns,
all triaged above). **Preview authoring is in progress**: 11 components
authored and graded `good` on every cell — Button, Badge, Input,
Textarea, Label, Select, ShortcutBadge, ProgressBar, UserAvatar,
Spinner, SkeletonBlock. The calibration set earned its keep twice, in
each case catching a defect that would have degraded every design:
the dark-surface bug and the static-CSS safelist gap above. The
remaining 173 components ship the honest floor card.

Authoring loop that works (solo, no fan-out used):
`.design-sync/previews/<Name>.tsx` → `node .ds-sync/lib/preview-rebuild.mjs
--components <names>` → `node .ds-sync/package-capture.mjs --components
<names>` → Read `ds-bundle/_screenshots/review/<group>__<Name>.png` →
write `.design-sync/.cache/review/<Name>.grade.json`. Preview files
import from the bare package specifier (`@proliferate/ui`); the
converter shims it to the window global, so subpath imports are neither
needed nor correct. **Use the EXPORT name, not the registry label** —
`Skeleton` in the playground registry is exported as `SkeletonBlock`,
and a mismatched filename is silently skipped ("not in
.stories-map.json"). **Nothing uploaded**: `DesignSync` returned an
authorization error in this remote (claude.ai/code) session
(`/design-login` needs an interactive terminal); resolve via Claude
Design's "Send to Claude Code Web". `config.json` therefore has **no
`projectId`**, and no project was created.

## Re-sync risks

- The synthesized entries are regenerated from each package's `exports`
  map, so **adding a subpath export is picked up automatically** — but a
  NEW name colliding across the two packages would be silently dropped by
  `export *`. `make-entries.mjs` pins only the three known collisions; if
  the collision count changes, the pin list needs updating.
- `.ds-compiled.css` is Tailwind output over `@source` globs pointing at
  `ui/src` and `product-ui/src`. A new DS package (a third one) would
  need adding to `.design-sync/css/ds-source.css` or its classes will be
  missing from the compiled set with no error.
- The icon exclusion list in `componentSrcMap` was generated from the
  icon `.d.ts` files at sync time. New icons will appear as cards until
  the list is regenerated.
- `.design-sync/css/geist.css` hardcodes paths into
  `apps/packages/design/node_modules/geist/...`. A geist major bump or a
  hoisting change breaks it — the symptom is `[FONT_DANGLING]` returning.
- Preview scope was never confirmed with the user; the 184-card set and
  the icon exclusion are this run's judgment, recorded above.
