# UI foundation pass — completion report

Date: 2026-07-24

Branch: `ui-foundation-pass`

Base: `9a1ca08b9`

Initial implementation head before this report: `a18db6a31`

Round-one review base: `1d38e88ae`

## Outcome

The frozen foundation retune is implemented across the shared design, UI,
product UI, and product client packages. The result has one generated web
token authority in `@proliferate/design`, a closed semantic type and glyph
vocabulary, semantic state/radius/layer/motion usage, design-derived code
palettes, and the sanctioned row-action primitive adopted across the complete
20-site census.

The implementation spans 472 committed files at the pre-report head. No Rust
or Docker command was run, `pnpm install` was not run, and the app was not
booted. Visual before/after verification remains with the orchestrating
reviewer as required by the handoff.

## Phase 1 — frozen retune specification

- Wrote and committed `.foundation-scout/retune-spec.md`.
- Disposed all 285 current global custom properties:
  176 shipped, 39 deliberately retuned or mapped, and 70 removed.
- Specified the final 280-token live authority and exact 15-name tagged alias
  set.
- Froze the semantic type, state, radii, layering, shadow, motion, spacing,
  raw-color, appearance, code-palette, and row-action mappings.
- Recorded the enumerated visual-retune changelog and Claude's rulings for the
  deterministic type fallback, token names, title tracking, 5px spacing,
  fixture color scope, and nested z-order.

## Phase 2 — generated design authority

- Made `apps/packages/design/src/tokens.ts` the literal authority for web,
  code-palette, motion, and native projections.
- Extended theme generation to emit `@theme`, one dark root, one flattened
  light root, semantic utilities, finite motion, and the retained activity
  animation contract.
- Removed global token declarations from `dom.css` and `product.css`; those
  files now own non-token CSS only.
- Kept React Native shadows hand-authored and linked their semantic values to
  the CSS authority.
- Added independent drift, disposition, alias, motion, native-projection,
  authored-CSS, and generated-output checks.
- Added a Tailwind parse check for the generated stylesheet and an eager
  stylesheet HTTP assertion. These caught and fixed a malformed
  `--shadow-modal` value before delivery.

## Phase 3 — appearance and consumer wiring

- Re-anchored the existing appearance formulas to the frozen semantic ramp
  without changing `WINDOW_ZOOM_SCALES`.
- Preserved all-preset structure, including
  `chat.lineHeight === composer.fontSize + 7`.
- Updated exact appearance pins and CSS drift checks.
- Derived Shiki's existing public exports and Monaco's retained exports from
  the design code palette without changing their consumer shape.
- Wired direct design-package dependencies where semantic motion and palette
  values are consumed.

## Phase 4 — exhaustive migrations

- Replaced all 756 inventoried generic type utility occurrences with their
  context-owned semantic roles.
- Migrated ruled foreground interaction overlays and historical accent states
  to `hover`, `active`, and `selected` roles.
- Migrated arbitrary radii, arbitrary z layers, ruled 5px gaps, arbitrary icon
  geometry, deprecated shadows, numeric motion utilities, and animation-owned
  JavaScript constants to the frozen vocabulary.
- Recorded `[ICON-04]` for the playground/prototype-only glyph normalization:
  fixed `size-3`/`size-3.5`/`size-4` classes and numeric `AgentGlyph` props
  moved to the nearest semantic tier, producing the audited ±1–2px shifts.
- Preserved the ruled raw-color exclusions for playground/fixture assets and
  the two explicit production cases; all other scoped raw colors use design
  authority.
- Added `RowActionIconButton` and `RowActionIndicator`, including fixed
  geometry, semantic states, reveal/pointer behavior, active/open behavior,
  ref forwarding and measurement, accessibility, disabled behavior, and
  stopped row propagation.
- Adopted the primitive or its non-interactive companion interpretation at
  all 20 census sites. The local automation row-button visual primitive was
  removed.

## Phase 5 — enforcement

- Expanded `scripts/check_appearance_scaling.py`, the CI-enforced source-check
  path, to cover the full foundation vocabulary.
- Added 22 focused unit tests for the gate.
- Added checked-in baselines for the 95 sanctioned standard numeric z
  occurrences and 29 existing long-list signatures. These baselines may only
  shrink.
- Updated the canonical frontend styling and appearance-scaling documents.

Final unmigrated counts:

- generic `text-xs` / `text-sm` / `text-base` / `text-lg` / `text-xl`: 0
- arbitrary text-size, radius, z, ruled gap, and ruled icon-size utilities: 0
- historical accent interaction/selection consumers: 0
- foreground-alpha interaction and ruled static fills at 10% or lower: 0
- deprecated/arbitrary shadow consumers covered by the frozen map: 0
- numeric finite motion and inline easing consumers covered by the map: 0
- scoped raw-hex violations: 0
- row-action census sites not adopted: 0
- `ui-foundation-escalation` tags in implementation source: 0

## Verification

All final commands below passed:

- `python3 -m unittest scripts/test_check_appearance_scaling.py`
  — 22 tests.
- `python3 scripts/check_appearance_scaling.py`
  — complete source gate.
- `python3 scripts/check_docs.py`
  — 233 Markdown files.
- `python3 -m py_compile scripts/check_appearance_scaling.py scripts/test_check_appearance_scaling.py`.
- `git diff --check`.
- `pnpm --filter @proliferate/design build`
  — 280 live tokens, 176 shipped dispositions, 39 retuned dispositions,
  70 removals, and 15 aliases; generated CSS also parsed by Tailwind.
- `pnpm --filter @proliferate/design typecheck`.
- `pnpm --filter @proliferate/ui build`.
- `pnpm --filter @proliferate/ui typecheck`.
- `pnpm --filter @proliferate/ui exec vitest run --maxWorkers=1 --minWorkers=1`
  — 12 files, 32 tests.
- `pnpm --filter @proliferate/product-ui build`.
- `pnpm --filter @proliferate/product-ui typecheck`.
- `pnpm --filter @proliferate/product-ui exec vitest run --maxWorkers=1 --minWorkers=1`
  — 43 files, 235 tests.
- After round-one review,
  `pnpm --filter @proliferate/ui exec vitest run test/Button.test.tsx --maxWorkers=1 --minWorkers=1`
  and the targeted product-UI Markdown/Workspaces run both passed
  (1 UI test and 7 product-UI tests), followed by clean UI and product-UI
  typechecks.
- `pnpm --filter @proliferate/product-client typecheck`.
- `NODE_OPTIONS='--localstorage-file=/tmp/ui-foundation-node-localstorage' pnpm --filter @proliferate/product-client exec vitest run --maxWorkers=1 --minWorkers=1`
  — 634 files, 3,826 tests.
- Product-client Markdown cascade integration verified that the eager
  stylesheet returned HTTP 200 and that ordinary and proposal semantic
  heading hierarchies rendered their pinned values.
- After mirroring the package's non-code assets to its ignored `dist`,
  `pnpm --filter @proliferate/web exec vite build`
  — 4,817 modules transformed and production CSS emitted.

All package work was serialized and Vitest used one worker because the machine
remained at memory-pressure level 2 with heavily used swap.

## Failures encountered and resolved

- The first full UI test run had one stale test pin for the old 24px sidebar
  action. It was updated to the frozen 28px box / 16px glyph contract; the
  final suite passed 32/32.
- The first full product-client run passed 3,816/3,826 tests. Four files
  accounted for all failures:
  - the Markdown cascade exposed the malformed generated modal-shadow token,
    which made Tailwind return HTTP 500 for the eager stylesheet;
  - the diff-header test still read the removed `product.css` token block
    instead of the design authority;
  - two appearance lifecycle assertions retained pre-retune size pins;
  - six unrelated updater mock cases required Node's localStorage backing-file
    flag in this runtime.
  The three foundation defects/pins were fixed, the updater file passed 6/6
  with the runtime flag, and the final full client suite passed 3,826/3,826.
- A direct Vite production-build shortcut initially failed because it bypassed
  the product-client asset-copy step and therefore lacked ignored
  `dist/index.css`. Running the documented asset mirror before the same Vite
  command produced a successful build.
- The successful Vite build retained existing non-fatal warnings for runtime
  Geist font URL resolution, a mixed static/dynamic import, and large chunks.
- Claude's first adversarial review found seven migration omissions: the
  removed keystone shadow utility on the primary button, a dropped
  `leading-none` on the confirmation title, and five section 5.1.1 owners
  containing six raw foreground-alpha fills. All were repaired according to
  their frozen roles. The source gate now rejects the removed keystone
  utility and both interaction and bracket-authored static foreground fills
  at 10% or lower, closing the detection gap that allowed the omissions.

## Deviations and founder judgment

There are no known deviations from the frozen retune specification and no
remaining escalation tags. No founder judgment is currently required.
Rendered visual verification is intentionally deferred to Claude's review
loop; any resulting finding will be repaired and recorded before approval.
