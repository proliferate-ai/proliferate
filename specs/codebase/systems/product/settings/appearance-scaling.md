# Appearance Scaling

Status: target

Current gap: Desktop/Web already persist and apply independent UI font,
readable-code font, and window-zoom preferences, but the visible contract is
incomplete. At the frozen base, Default message/composer text is 13px while
Default readable code is 10px; the target separates chat content from compact
chrome at 16px/24px while keeping Default body and readable code at 13px. A
production scan also finds 32 fixed text-size declarations across 20 files and
107 fixed-size vector-glyph call sites. Those fixed consumers respond to
whole-window zoom but generally do not respond to the UI font preference.

Frozen delivery base: `ec2aafc2cf1d0d254adfce1bb0084a90e06e4b38`.

## Outcome and boundary

The Appearance controls must be truthful across the shared Desktop/Web
product:

- UI font size owns every non-code product text role and every
  Proliferate-owned vector glyph.
- Readable code font size owns Monaco, xterm, diffs, code blocks, file-source
  views, and code-shaped diagnostic output.
- Window zoom remains an independent multiplier over the whole rendered
  component tree.

This is one indivisible Appearance-preference flow across auth, home,
workspace, sidebar, settings, dialogs, error recovery, and shared Cloud product
surfaces. A partly migrated product is not an acceptable intermediate target.
Mobile remains outside this DOM preference contract until it exposes an
equivalent native setting.

## Design reference

- **Primary reference:** local desktop reference captures (untracked `reference/` tree).
- **Exact state:** the open file-browser/file-tree workspace preserved as
  a `1800 × 1600` deterministic replay of saved live DOM with the installed
  renderer's adopted stylesheet. Its measured file-tree row uses 13px text in
  a 28px row with a 10px label/icon gap.
- **Match:** one legible scale per semantic role, code that is not artificially
  smaller than surrounding reading text, label/icon optical sizing that moves
  together, and stable compact-control hit areas.
- **Intentional differences:** Proliferate retains eight independent UI and
  readable-code presets, existing fonts, the 40rem shared chat column, themes,
  and separate window zoom. Chat/composer content is three pixels larger than
  the same preset's compact body and code roles.
- **Founder-approved Proliferate mock:**
  [Default and Extra Large scale contract](appearance-scaling-mock.svg). The
  founder approved the mock direction and complete-coverage rule on
  2026-07-19.

![Default and Extra Large proportional appearance scaling](appearance-scaling-mock.svg)

## Control flow

```text
uiFontSizeId
  -> UI_FONT_SCALES
  -> root semantic --text-* and --icon-* variables
  -> every owned non-code text and vector-glyph consumer

readableCodeFontSizeId
  -> READABLE_CODE_FONT_SCALES
  -> Monaco + xterm + diffs + code blocks + file source + diagnostics

windowZoomId
  -> existing whole-renderer zoom path
```

The three stored ids remain independently selectable, persisted, resolved, and
applied. Invalid or missing ids continue to fall back independently to
`default`.

## Chat-content and readable-code roles

For every `id` in `APPEARANCE_SIZE_IDS`, readable code follows the compact body
ramp while chat and composer content use a dedicated three-pixel-larger ramp:

```text
READABLE_CODE_FONT_SCALES[id].monacoFontSize
  = px(UI_FONT_SCALES[id].body.fontSize)
  = px(READABLE_CODE_FONT_SCALES[id].diffsFontSize)
  = px(READABLE_CODE_FONT_SCALES[id].codeFontSize)

px(UI_FONT_SCALES[id].chat.fontSize)
  = px(UI_FONT_SCALES[id].composer.fontSize)
  = px(UI_FONT_SCALES[id].body.fontSize) + 3

px(UI_FONT_SCALES[id].chat.lineHeight)
  = px(UI_FONT_SCALES[id].composer.fontSize) + 8
```

| Preset | Body/readable code | Message/composer |
| --- | ---: | ---: |
| Extra Extra Small | 11px | 14px |
| Extra Small | 11.5px | 14.5px |
| Small | 12px | 15px |
| Default | 13px | 16px |
| Large | 14px | 17px |
| Extra Large | 15px | 18px |
| Extra Extra Large | 16px | 19px |
| Extra Extra Extra Large | 17px | 20px |

Editor, diff, and terminal line heights remain readable, strictly monotonic,
and greater than their font sizes; they do not need to equal prose line height.

## Semantic text and glyph contract

- Every user-visible owned string resolves through a semantic text role,
  including badges, counts, keyboard hints, empty states, dialogs, errors,
  auth/brand text, terminal-login text, and code-adjacent labels.
- Every owned vector mark resolves through a semantic optical tier, including
  icons, chevrons, close controls, disclosure glyphs, status symbols, dirty
  markers, provider marks, and icon-font characters.
- `body` inherits the primary `--text-ui` role as the safety net for otherwise
  untyped owned strings and icon-only controls. Role-specific utilities still
  override that fallback, and the unchanged `html` root keeps rem-based layout
  geometry independent from the UI font preference.
- Paired row/button icons default to `1.15em` of their owning label. Compact,
  large, and display tiers remain proportional to a semantic text owner.
- Visible glyphs scale inside their existing accessible target. Pointer hit
  areas and structural row heights stay fixed unless an existing responsive
  contract already scales them.
- Build-time CSS defaults equal the runtime Default rung so pre-hydration and
  hosted-Web rendering cannot drift.
- Third-party numeric APIs receive a value resolved by the appearance owner;
  they do not own literal sizes at feature call sites.

Raster media, user avatars, screenshots, borders, shadows, and pointer hit
targets are not glyph icons and do not become font-relative.

## Ownership and implementation seams

- `apps/packages/product-client/src/lib/domain/preferences/appearance.ts`
  owns UI, readable-code, window-zoom, and semantic glyph ladders. This remains
  a connected Desktop/Web `src/lib/domain/**` owner; it is not moved into the
  sibling Mobile-safe `src/domain/**` subtree.
- `apps/packages/product-client/src/config/theme.ts` applies the resolved text
  and readable-code root variables through `applyAppearancePreference`; the
  stable `em` glyph ratios resolve from design CSS against those text owners.
- `apps/packages/design/src/css/product.css` owns Default CSS fallbacks and
  global semantic utilities.
- [tw-merge.ts](../../../../../apps/packages/product-client/src/primitives/utils/tw-merge.ts)
  preserves custom semantic utilities where Tailwind merge classification
  requires registration.
- Production consumers live under `apps/packages/product-client/src` and
  `apps/desktop/src`. Component-local aliases must
  not preserve a fixed-size path.
- `apps/packages/product-client/src/domain/**` is headless. The source guard
  scans it as part of the package root, but it must produce no styling, DOM,
  primitive, or appearance-consumer dependency.
- Focused appearance/drift tests and a repository source guard own regression
  enforcement.

The glyph ladder is exposed as `--icon-status`, `--icon-compact`,
`--icon-paired`, `--icon-control`, `--icon-large`, and `--icon-display`.
The matching `icon-*` utilities size only the visible vector through those
properties; wrappers keep owning fixed pointer-target and row geometry.

## Repository enforcement

Repo checks must reject raw fixed production text or glyph sizing at product
call sites. The migration inventory is generated from the final PR head and
must reach zero.

`scripts/check_appearance_scaling.py` is the no-allowlist production guard. It
runs in the repo-shape CI job and from the Desktop design-system check; its
focused unit test locks fixed text, imported/custom/inline SVG, descendant
selectors, component-local glyph props/aliases/defaults, status-dot, and global
CSS-alias failure cases.

Allowed numeric definitions are limited to:

- the canonical appearance ladders and matching CSS Default fallbacks;
- non-glyph geometry such as hit targets, rows, avatars, media, and hairlines;
- a documented third-party adapter whose numeric value is derived from the
  active preference.

There is no open-ended allowlist. Every structural exception names its semantic
reason in the guard. A developer adding a fixed `size={16}` glyph must get a
failing repository check before merge.

## Failure behavior

- Missing CSS variables fall back to the same Default geometry that hydration
  applies.
- Changing UI size does not change readable code when the readable-code id is
  unchanged; changing readable-code size does not change UI text or glyphs.
- Window zoom continues to increase or decrease the complete rendered
  component tree without rewriting either font preference.
- Enlarged text and glyphs use the owning surface's existing wrap, truncate, or
  scroll behavior. Essential labels and accessible targets must not be clipped.
- A missed owned call site is a release blocker, not deferred cleanup, because
  mixed scaling makes one selected preset internally inconsistent.

## Non-goals

- Mobile/native appearance controls.
- Font-family, weight, color, spacing/density, chat-width, other typography
  roles, or window-zoom redesign.
- Scaling raster media, avatars, borders, shadows, or hit targets as glyphs.
- Redesigning individual product surfaces while migrating semantic sizing.
- Raising bundle caps or absorbing unrelated JavaScript/Rust failures.

## Acceptance and proof

- At all eight presets, Monaco, xterm, diffs, code blocks, and file-source views
  equal the same-named body font size; message/composer stays exactly 3px larger.
- Default computes to 16px/24px for message/composer and 13px for body/readable
  code; Extra Large computes to 18px chat and 15px body/readable code.
- UI, readable-code, and window-zoom preferences remain independent in storage
  and application.
- The production source guard finds zero raw fixed text sizes outside canonical
  ladders/preference-derived adapters and zero raw fixed glyph dimensions at
  product call sites.
- Paired icons stay within 0.5 CSS px of their semantic ratio at Default and
  Extra Large while accessible targets remain usable.
- Matching `1280 × 720` real-product captures cover Appearance settings and a
  populated workspace with sidebar, message, inline code/diff, composer, right
  file tree, and terminal at Default and Extra Large.
- A `900 × 720` capture proves enlarged content does not clip essential labels
  or controls.
- One 10–30 second recording changes UI size and readable-code size separately
  and shows no cross-coupling.
- Focused behavior, drift, and source-guard tests; product-client/shared package
  typechecks; frontend boundary/strict-structure checks; `git diff --check`;
  login-budget proof; and PR metadata/readiness checks pass.
- This frontend-only change runs no Rust build and starts no Docker stack.
