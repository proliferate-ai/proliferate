# Design System

The single entry point for the design system: the philosophy and reference
precedence that decide a value, the ruled look those decisions produced, the
gates that keep the codebase on it, and the change-control model for moving a
value.

**Two records, one authority.** This document is the durable prose record of
*why* the system looks the way it does;
[tokens.ts](../../../../apps/packages/design/src/tokens.ts) is the value
authority and the only artifact that can settle a number, with its inline
`[RETUNE:…]` provenance comments carrying per-value attribution.
Where the two disagree about a value, `tokens.ts` is right and this document is
stale. The reference-alignment pass that produced these rulings
(`ui-foundation-target-v2.md`, `ui-foundation-chat-addendum.md`, and the
`.foundation-scout/retune-spec.md` capture census) is a historical rulings
record archived on the `ui-foundation-pass` branch; per
[specs/README.md](../../../README.md) git history is the archive, and those
documents are not a live read path — this document plus `tokens.ts` provenance
replace them.

**Owns:** the ruled look of the system (type ramp, control weight, composer and
transcript anatomy, tab strip, icon tiers), the clean-redo laws, and the
change-control model.

**Does not own:** per-component anatomy (the owning component lives in
[apps/packages/ui](../../../../apps/packages/ui)), the source-layout and
class-authoring rules for styling
([structures/frontend/guides/styling.md](../../structures/frontend/guides/styling.md)),
the gate script's own contract
([systems/product/settings/appearance-scaling.md](../../systems/product/settings/appearance-scaling.md)),
or the historical capture evidence behind each adopted value (the archived
rulings record above).

## Where The System Lives

```text
apps/packages/design/
├── src/tokens.ts                 the value authority: every color/type/radius/size/motion token
├── src/motion.ts                 duration + easing primitives tokens.ts composes
├── scripts/generate-theme.mjs    projects dist/tokens.js → dist/theme.css
├── scripts/copy-dom-css.mjs      copies every src/css/*.css (dom/product/desktop) into dist/css
└── scripts/check-theme.mjs       re-projects independently, asserts byte equality + Tailwind compile() + dom.css import order

apps/packages/ui/src/primitives/RowActionIconButton.tsx   sanctioned row-action primitive (size-7 box, icon-control glyph)

scripts/check_appearance_scaling.py   the class-level gate (arbitrary radius/z/gap/size and text/leading brackets, stock+keystone shadow, foreground-alpha, raw hex, backdrop-filter, numeric-duration and long-list bans)
scripts/git-hooks/pre-commit          staged-file gate; documents the load-bearing build order
Makefile                              wires the hook (core.hooksPath scripts/git-hooks) via the git-hooks target
```

## Design Philosophy

**Codex-first reference precedence (R-V2-1, ruled Pablo 2026-07-25):** "Codex UI
is preferred in general; Conductor is authority only where the product's shape
matches Conductor and not Codex."

Operationalized:
- **Codex is the default authority** for every Codex-analogous surface: chat
  input/composer, transcript/messages, buttons and icon controls,
  popovers/menus, settings, file tree, panels/toolbars, empty states. Where
  both references were captured for the same surface, the Codex value wins
  unless a ruling below says otherwise.
- **Conductor is the authority only for product shapes Codex doesn't have**:
  the multi-tab chat strip (we keep multiple chat tabs — anatomy/motion align
  with Conductor's `center-tab-strip/` + `center-session-tab/` captures), and
  any other multi-session sidebar/workspace structure without a Codex
  analogue.
- **Tie-break**: Codex wins on *style* (color roles, type, radii, shadows,
  motion feel); Conductor wins only on *structure* Codex lacks.
- Every adopted value cites its capture evidence path. PR #1484 had already
  chosen Codex numbers at its decision points (13/20 chat, 16px-glyph/28px-box
  row actions, Codex-soft radii); this precedence is that pattern made law
  rather than decided case-by-case.

## Clean-Redo Laws

These laws exist because #1484 broke each one. They are kept because the gate
or stage named under each is what caught the failure.

> **Generated CSS is validated through a real engine from commit one.**
> A syntactically-broken `--shadow-modal` shipped undetected in #1484 and 500'd
> the JIT stylesheet, because the Tailwind `compile()` pass and the `dom.css`
> import-order assertion were retrofits. Enforced by
> [check-theme.mjs](../../../../apps/packages/design/scripts/check-theme.mjs)
> which runs both from the first commit.

> **Gate regexes ship at full strength, never staged.** Seven violations
> survived #1484's first pass through detection gaps: an alpha regex that only
> matched interaction-prefixed fills, and a shadow ban that omitted
> `keystone`. Enforced by `FOREGROUND_ALPHA_RE` and `OLD_SHADOW_RE` in
> [check_appearance_scaling.py](../../../../scripts/check_appearance_scaling.py)
> (neither regex, nor any `ARBITRARY_*_RE`, existed in the 311-line version of
> that script this system replaced).

> **Adversarial review is a stage, not a favor.** It caught the seven gaps
> last time; during the pass, an independent review agent swept the census
> after migration and its findings had to reach zero before the founder
> checkpoint.

> **Known collision points are re-derived, never pattern-copied.**
> [RepoActionsPane.tsx](../../../../apps/packages/product-client/src/components/settings/panes/repo/RepoActionsPane.tsx)
> and [RepoPicker.tsx](../../../../apps/packages/product-ui/src/settings/RepoPicker.tsx)
> changed on `main` via #1485 in retune-relevant className literals; copying
> #1484's diff would silently revert that work. These are the only two drifted
> files out of #1484's 473-file footprint.

> **Rendered visual verification is in scope.** #1484 deferred it and shipped
> visual defects the token diff could not show; the served build was inspected
> per-surface against the reference contact sheets before the checkpoint.

> **No exception without a sanction trail.** Baselines that can grow silently
> stop being baselines: every new long-list / z-index / ban-exemption entry
> requires a written sanction in the component catalog or spec, so baseline
> files only shrink.

## Ruled Retune Decisions

### Type ramp
Closed body ramp — authored px, paired line-height AND letter-spacing per
step (Conductor's discipline; sizes anchored where Codex and Conductor
converge):
- `11/15 +0.01em` → meta/labels (`text-ui-sm`)
- `12/17 +0.005em` → compact UI, sidebar (`text-ui`)
- `13/20 0` → chat, message, composer (Codex renders chat exactly `13/20`)
- `14/21 −0.005em` → body emphasis, workspace title
- Titles: `16/23 −0.01em`, `19/24 −0.025em`; hero `26/34 −0.025em`.
- Nothing else is legal. Generic Tailwind steps (`text-xs/sm/base/lg/xl`) are
  deleted; all 756 census sites were migrated to the semantic roles.

### Control weight 450 → system-stack rendering
One characteristic control weight: **450** (`--font-weight-control`, provenance
`[RETUNE:type/control-weight]`). The only captured evidence is Codex's raw
composer measurement — weight `445` with font stack
`-apple-system, system-ui, "Segoe UI", sans-serif` ([CHAT-01] editable-text
row); 450 is the ruled rounding of that 445 onto the variable-font
medium-light axis. No Conductor capture for control weight exists in the
archived rulings record or in `tokens.ts`, so no Conductor attribution is
claimed here.

**UI font: one swappable slot.** All type references a single `--font-sans`
token, so testing an alternative is a one-value change. What currently ships in
[tokens.ts](../../../../apps/packages/design/src/tokens.ts) is the **Codex native system
stack** (`-apple-system, BlinkMacSystemFont, ui-sans-serif, system-ui,
"Segoe UI", sans-serif`, provenance `[RETUNE:type/Geist]`, landed as
`8fe170180`). Geist was the earlier ruling (Pablo 2026-07-24) and is preserved
in git history as the revert target: swapping back is reverting that one token
value. Geist Mono still ships as `--font-mono`.

### Composer anatomy ([CHAT-01]/[CHAT-02])
- **Radius: 12px** (`--radius-composer: 0.75rem`) — a *conscious deviation*
  from Codex's literal authored composer radius (20px, Codex's own `--radius-3xl`, or
  25px at the 1.25 corner-radius scale). Kept because [RAD-04] already rules
  it and [CHAT-01]'s own prose cites it explicitly.
- **Control-row gaps: 8px** (`gap-2`) — [CHAT-02] wins over [SPACE-01]'s
  generic "five `gap-[5px]` sites → 6px" ruling for composer sites
  specifically; Codex's raw literal is `gap-x-[5px]`, but the ruling amends
  [SPACE-01]'s composer sites to 8px.
- **Surface: dark-only translucency.** `--color-composer-background` dark
  becomes `color-mix(in oklab, #2d2d2d 96%, transparent)` (theme fallback
  `rgba(45, 45, 45, 0.96)`) — Codex's `--color-token-input-background`
  observed value, expressed in the house `color-mix()` form. **Light is
  unchanged**, keeping its shipped `rgba(255, 255, 255, 0.864)`: light was
  already translucent, so the capture pass found no light-mode gap. This is the
  core visual gap [CHAT-01] exists to close, and it is a dark-only retune.
- **Backdrop blur is a light-mode-only treatment.**
  `--color-composer-backdrop-filter` is `dark: none` / `light: blur(16px)`;
  the new translucent dark surface is deliberately *not* backdrop-blurred,
  because WKWebView re-blurs the whole transcript on every keystroke (the
  perf note recorded alongside the token). Raising light's alpha to dark's 96%
  would cancel that blur, so the translucency law applies per mode at the
  alpha each mode's backdrop treatment was tuned for.
- **Press overlay: 5.2%** — Codex's literal composer control active-press is
  `bg-token-foreground/15` (15%), stronger than the ruled `--color-active`
  (5.2%, sourced from the workspace-tab active state). Ruled vocabulary wins
  over the raw Codex number: composer press stays at **5.2%**, not 15%.
- Icon-only control box: 28×28px, no internal padding, glyph 16px inside
  (`icon-control` at `text-ui`: `--icon-control: 1.333333em` × 12px), matching
  `[ICON-03]`/`[ROW-ACTION-01]`'s 16px-glyph/28px-box pairing. (Codex spells
  this `icon-xs` as a fixed 16px class; we express it em-relative instead.)
- Elevation: `--shadow-composer → --shadow-subtle` = `0 1px 2px 0 rgb(0 0 0
  / 0.05)` — a deliberate, already-recorded collapse (RT-TOK-020) of Codex's
  two-layer `elevation-prominent` (`0 0 0 .5px border-heavy, 0 3px 7.5px
  #0000000a, 0 0 20px #0000000d`) into the flatter subtle shadow.
- Placeholder/tertiary text: `--color-foreground-tertiary` (50%, matches
  Codex's tertiary/description role ~49.8%) — replaces the current
  `text-muted-foreground` (70%, too opaque either way this is measured).

### Transcript ([CHAT-04])
All three transcript values are deliberately authored into Tailwind's own
`--container-*` / `--spacing-*` namespaces — that is why the names read oddly.
Namespacing them means consumers write `max-w-transcript-readable` and
`gap-transcript-turn`, which resolve as real utilities instead of arbitrary
bracket values. The bracket-ban rationale is literal only for
`--spacing-transcript-turn` (`gap-[12px]` is caught by `ARBITRARY_GAP_RE` in
[check_appearance_scaling.py](../../../../scripts/check_appearance_scaling.py)); the gate
has no `max-w` rule, so for the two `--container-*` widths the namespacing is a
consistency choice, not gate-forced. (`tokens.ts:1094-1095` still carries the
overbroad claim; see Current gaps.)
- **Readable width: 40rem** (640px) — `--container-transcript-readable`, new
  token, no existing equivalent; Codex's `--thread-content-max-width: 40rem`
  on `._markdownContent_1wddj_66`.
- **Wide width: 64rem** (1024px) — `--container-transcript-wide`, new token;
  Codex's `--markdown-wide-block-max-width: 64rem`.
- **Turn gap: 12px** — `--spacing-transcript-turn` (`0.75rem`); Codex's
  observed inter-turn `gap: 12px` (inline, virtualized), sitting between
  Codex's own authored `--conversation-item-gap: 16px` and
  `--conversation-grouped-item-gap: 4px`. Note Tailwind v4 does not derive
  `space-y-*` from the spacing namespace, so a `space-y-4` turn stack converts
  to a flex column with `gap-transcript-turn`.
- User-message bubble `max-w-[77%]` already matches Codex's literal value and
  needs no change and no sanction entry: the arbitrary-value gate bans
  radius/z/gap/size and `text-[…]`/`leading-[…]` brackets, not `max-w`, and the class is already live and
  passing in
  [UserMessage.tsx](../../../../apps/packages/product-client/src/components/workspace/chat/transcript/UserMessage.tsx)
  and
  [TranscriptPendingPromptRow.tsx](../../../../apps/packages/product-client/src/components/workspace/chat/transcript/TranscriptPendingPromptRow.tsx).

### Tab strip / tab close ([CHAT-05], Conductor carve-out)
- **Tab strip stays 28px** tall — Conductor's own capture is 40px
  (`h-10`), but the ruling keeps the current shipped 28px
  (`--workspace-shell-tab-height: 1.75rem`) since [CHAT-05]'s prose is silent
  on height and 28px is already load-bearing across the compact-control system.
- Tab radius: 6px stands per [RAD-07] — Codex-soft radii scale.
- **Tab close button: 20px** (`--size-icon-button-sm: 1.25rem`) — bumped up
  from the repo's current 16px (`size-4`) to match both Conductor's captured
  20px close-target and an already-legal ruled tier.
- Underline-tab redesign (Conductor's bottom-border active-indicator
  structure) ruled **out of scope** — the current filled/bordered active
  treatment (5.2% overlay + full border) stays; adopting the underline
  pattern would be a structural change beyond anatomy pinning.

### Icon tiers
Em-based semantic tiers (icon-paired/compact/control/status/large/display)
stay — structurally ahead of both references, already CI-enforced. Tuned
targets: 16px default glyph paired with 13px text (Codex), 12px glyph for
compact/meta rows (Conductor's dominant size), icon-only controls get a 28px
hit target (Codex). Container (tap-target) sizes join the system as their
own scale: legal boxes **20/24/28px**
(`--size-icon-button-sm/md/lg`). Retiring freehand `size-N` on icon buttons is a
**target, not a shipped constraint**: no gate rule restricts it (`ARBITRARY_SIZE_RE`
catches only `size-[…]` brackets) and `IconButton.tsx`, `PaneIconButton.tsx`,
`SidebarActionButton.tsx` and `Button.tsx`'s `icon-sm` still author raw
`size-5`/`size-6`/`h-7 w-7`. See Current gaps.
New sanctioned primitive: row-action icon-button (hover-revealed row controls —
sidebar kebab, archive, tab close, file-row actions), shipped as
[RowActionIconButton.tsx](../../../../apps/packages/ui/src/primitives/RowActionIconButton.tsx):
a `size-7` box with `[&_svg]:icon-control` glyph, translucent hover per Codex,
group-hover reveal per Conductor.

## Change-Control Model

- **All rulings are recorded, not silently applied.** Each deliberate value
  change carries a ruling ID (`D-V2-1`..`D-V2-4`, `R-V2-1`, `R-V2-2`) or a
  retune ID (`[CHAT-01..05]`, `[RAD-04]`, `[SPACE-01]`, `[STATE-02]`,
  `RT-TOK-…`, etc.). These IDs — wherever they appear in this document — cite
  entries in the archived rulings record (readable via
  `git show origin/ui-foundation-pass:<file>`), not identifiers in code; each
  carries a cited evidence path (computed.json /
  dom.html / css line / tokens.md row). Anything not on the enumerated
  changelog is verified unchanged (screenshot/computed-style comparison);
  any visual shift not on the list is a bug by definition.
- **Values live only in `tokens.ts`.**
  [tokens.ts](../../../../apps/packages/design/src/tokens.ts) (+
  [motion.ts](../../../../apps/packages/design/src/motion.ts)) is the
  single source of truth;
  [generate-theme.mjs](../../../../apps/packages/design/scripts/generate-theme.mjs) emits
  `dist/theme.css`, and
  [check-theme.mjs](../../../../apps/packages/design/scripts/check-theme.mjs) re-projects
  and asserts byte-equality against it. `product.css`/`dom.css` keep rules
  only, never token values. Shiki + Monaco palettes and the RN bridge all
  generate from the same source — no second place a color/radius/motion number
  can live.
- **Pre-commit + CI both gate drift.** A checked-in
  [pre-commit](../../../../scripts/git-hooks/pre-commit) runs the
  appearance-scaling check on staged frontend files plus the theme
  byte-equality check when `packages/design` files are staged (wired via
  `git config core.hooksPath scripts/git-hooks` from
  [Makefile](../../../../Makefile)); CI still catches anything bypassed with
  `--no-verify`.
- **Changing a value is a three-step edit, and the compile step is
  load-bearing.** Edit
  [tokens.ts](../../../../apps/packages/design/src/tokens.ts), then run the canonical
  build: `pnpm --filter @proliferate/design build`, which is
  `tsc -p tsconfig.json && node scripts/generate-theme.mjs && node
  scripts/copy-dom-css.mjs && node scripts/check-theme.mjs`. The `tsc` step
  cannot be skipped: `generate-theme.mjs` imports the compiled
  `../dist/tokens.js`, not the source, so without recompiling first the
  generator re-projects whatever was compiled last time and the byte-equality
  check passes on a stale theme. The pre-commit hook documents this order for
  the same reason.
- **Post-landing tweakability is a design goal**: because every value flows
  from `tokens.ts`, tuning any font/icon/motion/color value later is that one
  edit plus the build — checkpoints bless the *system*, not eternal values.
- **Escalation convention**: ambiguous mappings during migration get an
  inline `ui-foundation-escalation:` tag; zero tags must remain at
  completion. The archived addendum's format (evidence path → maps-to column →
  flagged conflict) is the template for any future reference-alignment pass.

## Failure Modes

| Condition | What a consumer observes | Recovery |
| --- | --- | --- |
| `tokens.ts` edited without rebuilding | `check-theme.mjs` fails byte-equality (or, worse, passes on a stale `dist/theme.css` if `tsc` was skipped) | run `pnpm --filter @proliferate/design build`; never run the generator alone |
| A token value is syntactically invalid CSS | Tailwind's `compile()` pass in `check-theme.mjs` fails; unguarded, the JIT stylesheet 500s at runtime and the app renders unstyled | fix the value in `tokens.ts`; the compile pass is the gate that keeps this pre-merge |
| A banned class (arbitrary radius/z/gap/size, stock/keystone shadow, `bg-foreground/<alpha>` at ≤ 10%, numeric duration) is introduced | `check_appearance_scaling.py` fails in pre-commit and CI, naming file and match | replace with the ruled token utility, or obtain a written sanction — baseline growth is not a fix |
| A hard-coded value lands in `product.css`/`dom.css` instead of `tokens.ts` | the token-declaration case *is* gated: `check_design_css_source` emits `authored-root-token` for any `--x:` in a global `:root`/`:root[…]` block and `authored-theme-block` for any `@theme`. Only a non-token literal inside a component rule (e.g. `background: #212121` in `.foo`) escapes, since `RAW_HEX_RE` is not run over design CSS — that one silently becomes a second source of truth and diverges mode-to-mode | move the value into `tokens.ts` and regenerate |
| Hook not installed (fresh clone, `core.hooksPath` unset) | local commits skip both gates; failure surfaces only in CI | run the `Makefile` target that sets `core.hooksPath scripts/git-hooks` |

## Current Gaps

Everything above describes current behavior. These are the places where a rule
this document states is not actually enforced anywhere, and the one known stale
claim in the code.

- Icon-button container sizes are asserted as the legal scale but are not
      enforced: no gate rule restricts freehand `size-N` on icon buttons
      (`ARBITRARY_SIZE_RE` in
      [check_appearance_scaling.py](../../../../scripts/check_appearance_scaling.py)
      catches only `size-[…]` brackets), and raw boxes remain legal and live in
      [IconButton.tsx](../../../../apps/packages/ui/src/primitives/IconButton.tsx)
      (lines 28-29, `size-5`/`size-6`),
      [PaneIconButton.tsx](../../../../apps/packages/ui/src/primitives/PaneIconButton.tsx)
      (line 6, `size-6`),
      [SidebarActionButton.tsx](../../../../apps/packages/ui/src/patterns/SidebarActionButton.tsx)
      (line 47, `size-6`) and
      [Button.tsx](../../../../apps/packages/ui/src/primitives/Button.tsx)
      (line 52, `icon-sm` = `h-7 w-7`). Closing it means either a gate rule or
      dropping the claim.
- [tokens.ts](../../../../apps/packages/design/src/tokens.ts):1094-1095
      claims the appearance gate bans arbitrary `max-w` bracket widths. It does
      not — the gate has no `max-w` rule, so the `--container-transcript-*`
      namespacing is a consistency choice. The comment should be corrected to
      match the Transcript section above.
- `apps/packages/design/dist/theme.css` is generated, not checked in, so a
      fresh checkout has no emitted file to read; the generated-CSS statements
      here are verified against `src/tokens.ts` plus the generator and checker
      scripts.
- No automated rendered-visual check exists. The change-control model
      requires per-surface inspection of the served build against the reference
      contact sheets before a founder checkpoint, and that step is human-run
      with no artifact retained.
