---
name: ui-conformance-review
description: >-
  Run the UI-conformance review checklist from specs/DESIGN_SYSTEM.md against a PR diff.
  Use when reviewing any PR that touches frontend components (apps/packages/product-client,
  apps/desktop, apps/web) - it checks shape placement, duplicate shapes pending promotion,
  hand-rolled overlay semantics, unsanctioned geometry, the lucide-react glyph ratchet, raw
  DOM controls, hand-assembled interaction-state stacks, and scaffold rhythm drift, with the
  doctrine's carve-outs applied so sanctioned patterns do not get flagged.
---

# UI-conformance review

The judgment half of design-system enforcement. The mechanical gates (`check_appearance_scaling.py`, `check_frontend_boundaries.py`, `report_frontend_structure.py --strict`, `check-theme.mjs`) already run in CI and pre-commit; this skill covers the eight things they cannot decide, defined in [specs/DESIGN_SYSTEM.md § Component Library → UI-conformance review](../../../specs/DESIGN_SYSTEM.md#component-library).

Read the doctrine section before reviewing. Read the sanctioned index **from the file**, never from memory - it is the closed set, and it changes.

## Ground rules

- Read-only. No builds, no installs, no `cargo`, no Docker, no test suites. Every command here is grep, git, or a small Python script.
- The five jobs table decides *what* a line is doing (paint / anatomy / state / layout / behavior). The placement algorithm and the rule of two decide *where* it belongs. A finding names the job and the rule, not just the line.
- Layout is free, always. Never open a finding on flex, grid, gap, padding-from-the-scale, width, or ordering at a call site.
- A signature firing is a *candidate*, not a finding. Every check below lists its carve-outs; apply them before writing anything down.

## Setup

```bash
REPO=$(git rev-parse --show-toplevel)
PR=<number>
BASE=$(gh pr view "$PR" --json baseRefOid --jq .baseRefOid)
HEAD=$(gh pr view "$PR" --json headRefOid --jq .headRefOid)
git fetch origin "pull/$PR/head" --quiet
gh pr diff "$PR" > /tmp/pr$PR.diff
SIG="$REPO/.claude/skills/ui-conformance-review/signatures.py"
FEATURE="apps/packages/product-client/src/components apps/desktop/src apps/web/src"
LIB="apps/packages/product-client/src/primitives apps/packages/product-client/src/components/patterns"
```

If the PR touches no `.tsx` under those roots, stop and report "no frontend surface".

---

## Check 1 - placement: new shape vs. redraw

**Doctrine.** Did the PR build row / card / banner / dialog DOM from raw elements when a pattern already owns that skeleton? And is every new library file in the tier its role demands, with an index row and a registry entry?

**Signature A - added files, routed through the placement algorithm.**

```bash
git diff --name-only --diff-filter=A "$BASE...$HEAD" -- '*.tsx' | grep -v '\.test\.tsx'
```

For each added file, answer in order: is it a value (token), one thing rendered (root primitive or `icons/`), a recurring skeleton or a kit member (`primitives/patterns/` if the props are only ReactNode/string/boolean/callbacks, `components/patterns/` if the public props reference a `#product/domain/**` noun **and** it composes two or more library components), or a surface (feature code, stays put forever)?

**Signature B - library files with no sanctioned-index row.**

```bash
for f in $(find $LIB -name '*.tsx' -not -name '*.test.tsx' -not -path '*__tests__*' | sort); do
  grep -q "$(basename "$f")" "$REPO/specs/DESIGN_SYSTEM.md" || echo "NO INDEX ROW: $f"
done
```

**Signature C - the redraw tell.** A container in feature code that paints a skeleton a pattern already owns:

```bash
python3 "$SIG" dupes --diff /tmp/pr$PR.diff     # see check 2; a hit here is also a redraw candidate
grep -nE '<div[^>]*className="[^"]*rounded-(sm|md|lg|xl|2xl)[^"]*(border|bg-)' /tmp/pr$PR.diff | grep '^[0-9]*:+'
```

Compare each candidate against `SettingsGroup` (wash card owning its own hairlines), `ListRow`, `EmptyState`, `ModalShell`, `PageContentFrame`, `PickerPopoverContent`, `ToastBody`.

**Carve-outs.**
- Filling a pattern's `ReactNode` slot with a `Badge`, a glyph, or a shortcut hint is the mechanism working. What is banned is redrawing the skeleton *around* the slot contents. The same table applies inside the slot: slot content may compose library components and layout, but must not itself constitute a new repeating skeleton.
- A first-instance novel shape legitimately lives in feature code with token paint only. It gets no index row and no registry entry. Do not demand promotion on sight of one.
- `primitives/utils/**`, `primitives/overlays/**`, `primitives/__tests__/**` and `popover-surface.ts` are infrastructure, not components: no index row is expected.
- `components/patterns/secrets/*` other than `SecretManagementPanel` are documented private internals of that one export; the panel's index row covers them.
- `ToastBody` / `ToastExpansion` are registry-exempt kit internals (the registry test's glob exempts exactly those two).
- A kit member landing ahead of its consuming surface may carry an incubating note naming the in-flight PR. Non-kit components cannot be born incubating.

---

## Check 2 - second instance (the rule of two)

**Doctrine.** The PR that would introduce the second implementation of a shape anywhere in the tree must promote the shape instead of copying it. First instances have no index row, so check the known-duplicates list in Current Gaps **and** search the tree for the shape's signature, not only the index.

Shape identity is operational: same skeleton DOM plus same slot contract is the same shape; differing only in token values is the same shape; differing in slot structure is a different shape.

**Signature - paint fingerprint match against the tree.**

```bash
python3 "$SIG" dupes --diff /tmp/pr$PR.diff
```

The fingerprint is the sorted set of paint classes (`rounded-*`, `border*`, `bg-*`, `shadow-*`, `ring-*`, semantic `text-*`) in a literal `className`. Layout classes are dropped on purpose: two rows differing only in gap and padding are the same shape. A fingerprint of three or more paint classes that also appears in another file is a candidate second instance.

Standing census of what the tree already carries (run before reviewing so a pre-existing duplicate is not charged to this PR):

```bash
python3 "$SIG" dupes --tree --min-files 3
```

**Signature - dead library vocabulary (the inverse rule).** Every library component needs at least one non-playground call site:

```bash
for f in $(find $LIB -name '*.tsx' -not -name '*.test.tsx' -not -path '*__tests__*' \
             -not -path '*/icons/*' -not -path '*/utils/*' | sort); do
  n=$(basename "$f" .tsx)
  hits=$(grep -rl "[^A-Za-z0-9_]$n[^A-Za-z0-9_]" apps --include='*.tsx' --include='*.ts' \
          | grep -v "/$n.tsx$" | grep -v '/playground/' | grep -v '__tests__' | grep -v '\.test\.' | wc -l)
  [ "$hits" -eq 0 ] && echo "DEAD: $f"
done
```

A sanctioned component with zero consumers while feature code hand-rolls its shape is the exact failure the rule exists to catch. If the PR hand-rolls a shape that a dead library component already owns, that is a finding against the PR.

**Known duplicates already in the tree** (Current Gaps - do not charge these to a PR that merely touches the file):

| Shape | Where |
| --- | --- |
| Card shell `bg-card border border-border rounded-lg` | 9 files, mostly `components/workflows/**` |
| Composer control neutralization `bg-transparent border-0 shadow-none` | 8 files under `workspace/chat/input/**` (suppressed by the script as a neutralizer set) |
| Collapsed action row `bg-surface-elevated-secondary border-border/60 rounded-lg` | 3 files under `chat/tool-calls/**` |
| Notice/banner `rounded-lg border border-border bg-foreground/5 px-4 py-3 text-ui-sm text-muted-foreground` | `AccountPane.tsx`, `OrganizationPane.tsx` - byte-identical, and `ProductNotice` already owns this shape with zero call sites |
| Inline error `rounded-md border border-destructive/25 bg-destructive-subtle px-3 py-2 text-ui text-destructive` | `ApiKeyCreatorModal.tsx`, `SecretEditorDialog.tsx` - byte-identical |
| Settings row `flex items-center gap-3.5 px-3.5 py-[13px]` | ~10 files under `settings/panes/**` |
| Dead library vocabulary | `AuthProviderButton`, `ListRow`, `RangeSlider` (zero call sites), `ProductNotice` (outside every tier, zero call sites), `TypewriterRevealText` (live consumer and registry entry but no index row) |
| Split kits | toast positioner `Sonner` is a root primitive while the kit lives in `patterns/`; the settings kit spans `primitives/patterns/` and `components/patterns/` |

**Carve-outs.**
- Promotion is earned by duplication, never speculative. Do not ask for a library component because a shape "looks reusable".
- Kits are the one structural exception: a kit member is sanctioned with a single consuming surface. The kit set is closed - composer, toast, sidebar, tabs, panel, settings - or an explicit review sign-off recorded as a new named group in the index. A feature area is not a system.
- A kit member composed from another system's kit is adoption, not duplication.
- Fission (a variant with one consumer for a full release returns to its call site) applies to shared patterns only, **never to kit members**. A kit variant's fission target is another member of the same kit.
- Neutralization fingerprints (only `bg-transparent` / `border-0` / `shadow-none` / `ring-0` / `rounded-none`) are composition, not a shape; the script drops them.

---

## Check 3 - hand-rolled overlay semantics

**Doctrine.** Any new `role="dialog|menu|listbox|tooltip"` outside the library instead of composing `ModalShell` / `PopoverButton` / `Tooltip`, or `DropdownMenu` for keyboard-navigable menus.

```bash
grep -rnE 'role="(dialog|alertdialog|menu|listbox|tooltip)"' $FEATURE --include='*.tsx' \
  | grep -v '/primitives/' | grep -v '\.test\.tsx'
```

Run it on the tree for the baseline, then diff-scope it:

```bash
grep -nE '^\+.*role="(dialog|alertdialog|menu|listbox|tooltip)"' /tmp/pr$PR.diff
```

Also look for re-implemented behavior with no `role=` at all: a new focus trap, a new outside-click dismissal, a new positioning calculation.

```bash
grep -nE '^\+.*(useFloating|createPortal|getBoundingClientRect\(\).*(top|left)|addEventListener\("(keydown|mousedown)")' /tmp/pr$PR.diff
```

**Carve-outs.**
- `DropdownMenu` is the **sanctioned** path for menus that need keyboard navigation until `PopoverButton`/`PopoverMenuItem` reach parity (roving tabindex, typeahead, managed focus return). Its four current consumers - `WorkspaceItemMenu`, `RightPanelNewTabMenu`, `WorkspaceActionsMenu`, `ProposedPlanCard` - are not migration debt, and a *new* keyboard-menu consumer is legitimate. What is a finding is a **click-only** menu reaching for `DropdownMenu` instead of `PopoverButton`/`PopoverMenuItem`.
- `role=` inside a test file, a `querySelector` string, or an aria assertion is not a shell.
- Seven hand-rolled shells predate the rule (see the appendix). Touching one of those files is not a finding; adding an eighth is.

---

## Check 4 - geometry escape hatches

**Doctrine.** Arbitrary values or inline styles without a legitimate cause. Virtualization math and grid positioning are legitimate; decorative geometry is not. A legitimate cause is recorded in a comment at the site, so the judgment is visible in the diff.

Scope this check to the families the appearance gate does **not** cover. `rounded-[…]`, `z-[…]`, `gap-[…]`, `size-[…]`, `text-[…]`, `leading-[…]`, and numeric durations already fail `check_appearance_scaling.py`; width / height / padding / margin / inset brackets have no gate rule at all, which is why they are review's job.

```bash
GEOM='[ "]([a-z]+:)*((min-|max-)?[wh]|p[xytblr]?|m[xytblr]?|inset|top|bottom|left|right|translate-[xy]|basis)-\[[^]]+\]'
grep -nE "^\+.*$GEOM" /tmp/pr$PR.diff | grep -v '\[var(' | grep -v 'grid-cols-\[' | grep -v 'grid-rows-\['
# then group by literal - the count is what makes the finding, not the line:
grep -E "^\+.*$GEOM" /tmp/pr$PR.diff | grep -v '\[var(' | grep -oE "$GEOM" | sort | uniq -c | sort -rn
grep -nE '^\+.*style=\{\{' /tmp/pr$PR.diff
```

The `([a-z]+:)*` prefix is load-bearing: without it the signature misses variant-prefixed brackets like `lg:w-[22rem]` and `sm:p-[…]`.

Group the hits by literal before writing findings. One value repeated across N call sites is **one** finding ("this magic number wants a token or a shared constant"), and it is simultaneously a check-2 signal that a shape is being copied. A one-off value in a genuinely one-off position is a note at most.

**Carve-outs.**
- `[var(--token)]` is token consumption, not an escape hatch.
- `grid-cols-[minmax(...)]` / `grid-rows-[...]` is grid positioning - explicitly legitimate.
- Virtualization math, runtime-measured widths/heights/positions, and CSS custom properties passed into a class-driven layout are legitimate per [styling.md § Callsite Styling](../../../specs/frontend/styling.md); inline `style` is the sanctioned mechanism for genuinely dynamic values.
- `[direction:rtl]` / `[unicode-bidi:plaintext]` is the taught RTL path-truncation idiom.
- `bg-[var(--git-new-line-bg)]` and siblings are the taught git-diff colour path.
- A hit that already carries an explanatory comment at the site has satisfied the rule. Say so and move on.

---

## Check 5 - icon source (the lucide ratchet)

**Doctrine.** Glyphs come from `primitives/icons/`, never directly from `lucide-react`. The grandfathered files are a ratchet: no new lucide identifiers, **even on an existing import line**.

A plain `grep '^+.*lucide-react'` is wrong - it fires on any edit to an import line, including one that *removes* an identifier. Diff the identifier sets:

```bash
python3 "$SIG" lucide --base "$BASE" --head "$HEAD"
```

Any output is a finding. Fix: add or reuse the glyph in the matching module under `primitives/icons/` (`core`, `app-shell`, `platform`, `product`, `status`, `workspace`, `workspace-git`, `command-palette-icons`, `proliferate-icons`, `provider-icons`).

`primitives/icons/**` is the only legal `lucide-react` importer and the script exempts it. The ratchet direction is one-way: removals are always fine, so a PR that deletes lucide identifiers is a win to call out.

---

## Check 6 - raw DOM control gate

**Doctrine.** `report_frontend_structure.py --strict` (rule `RAW_DOM_CONTROL`) is the mechanical half. Review covers what the regex cannot see.

```bash
python3 "$REPO/scripts/report_frontend_structure.py" --strict
grep -nE '^\+.*<\s*(button|input|label|select|textarea)\b' /tmp/pr$PR.diff | grep -v '\.test\.'
grep -nE '^\+.*React\.createElement\(\s*["'"'"'](button|input|label|select|textarea)' /tmp/pr$PR.diff
```

Also read [components.md § Shared UI](../../../specs/frontend/components.md): a locally defined `Button` / `Input` / `Dialog` / `Menu` lookalike under any other name is the same violation, and no regex catches it. Check added files for a component that wraps or restyles a raw control.

**Carve-outs.**
- `document.createElement("textarea")` in a clipboard helper renders nothing - not a control.
- A polymorphic `as="button"` on a library primitive (`SidebarRowSurface as="button"`) is the primitive's own API.
- Files under `primitives/**` are the layer that is *allowed* to render raw controls.

---

## Check 7 - hand-assembled interaction-state stacks

**Doctrine.** New `hover:` / `active:` / `focus-visible:` choreography written on a raw element when an interactive primitive already owns those states. State has exactly one owner: the treatment lives inside the primitive or pattern (`Button`, `ListRow`, `RowActionIconButton`, `SidebarRowSurface`), never hand-assembled per call site - a per-callsite stack is where a missing `active:` hides until a user feels it.

```bash
python3 "$SIG" states --diff /tmp/pr$PR.diff
```

The script splits candidates two ways:

- **`CHECK7-HARD`** - the stack uses utilities outside the shared state vocabulary. This is a finding in both carve-out branches: the doctrine says a first-instance stack may be built *only* from the shared state tokens, and a stack built from non-state tokens is never legal. Typical offenders: `hover:bg-muted`, `hover:bg-hover/30`, `hover:bg-primary/30`, `hover:bg-[var(--x)]`, `hover:opacity-65`.
- **`CHECK7-SOFT`** - the stack is entirely in-vocabulary (`hover:bg-hover`, `bg-selected`, `active:bg-active`, focus ring, bare semantic colour promotion, `opacity-0` reveal, neutralization). Eyeball each one for the single question the script cannot answer: **does an existing primitive already own this exact treatment?** If the line is re-writing `Button`'s or `ListRow`'s or `SidebarRowSurface`'s states, it is a finding regardless of vocabulary. If it is a genuinely novel first-instance interactive shape, it is legal, and the stack promotes with the shape on its second appearance.

**Carve-outs (all encoded in the script's sanctioned set, restated here for the judgment call).**
- **First-instance carve-out.** A first-instance interactive shape with no fitting primitive may carry its own state stack in place, built only from the shared state tokens (`hover:bg-hover` / `bg-selected` / `active:bg-active` and the focus ring). What is banned is re-writing states an existing component already owns.
- **Hover-reveal idiom.** `group` + `opacity-0 group-hover:opacity-100` (with `transition-opacity duration-200`, group named when nesting is possible) is slot-content layout, not a state stack. Sanctioned by [styling.md § Hover Reveal Pattern](../../../specs/frontend/styling.md).
- **Colour-promotion idiom.** Never animate opacity between two *visible* values on an always-visible glyph; express muted-to-prominent as a colour change (`text-current/75 transition-colors group-hover:text-current`). A bare semantic foreground token under `hover:` is that idiom and is sanctioned. An alpha-suffixed background overlay is not.
- **Neutralization.** `hover:bg-transparent` on a library component is turning the primitive's own state off, not assembling a new one.
- 69 off-vocabulary occurrences across 49 files predate the rule (appendix). Charge the PR only for what it adds.

---

## Check 8 - rhythm

**Doctrine.** Rhythm is anatomy, not layout: containers own the space between their children. Where an area scaffold exists, inter-pattern spacing comes from it. Where no scaffold exists yet, a pane picks one spacing value and review checks consistency across sibling panes, not the choice itself.

**Scope this to scaffold-bearing areas only.** The check is about the space *between sibling patterns at a pane root*, never about spacing inside a row or a card.

```bash
# 1. Is there a scaffold? Read the area's shell component first.
#    Settings: components/settings/panes/SettingsScaffoldPane.tsx
# 2. Census the sibling roots (4-space indent = the component's root JSX element),
#    matched by role suffix so panes are compared with panes.
AREA=apps/packages/product-client/src/components/settings/panes
grep -rhoE '^    <(section|div) className="space-y-[0-9.]+"' "$AREA" --include='*Pane.tsx' \
  | sort | uniq -c | sort -rn
# 3. Read the root rhythm of every pane the PR touched and compare it to the mode.
#    Do NOT grep the diff directly: a raw '^+.*space-y-' match cannot tell a pane root
#    from a space-y-2 inside a row, and on #1777 that produced seven non-findings.
for f in $(git diff --name-only "$BASE...$HEAD" -- "$AREA" | grep 'Pane\.tsx$'); do
  printf '%s : %s\n' "$f" "$(grep -m1 -oE '^    <(section|div) className="space-y-[0-9.]+"' "$f" || echo '(no root rhythm)')"
done
```

The mode is the area's rhythm. A pane that differs from it is the finding; the mode itself is never the finding.

**Carve-outs.**
- Intra-pattern spacing (a `space-y-2` inside a settings row, a `gap-3` inside a card) is layout and is free.
- Files whose role suffix is not the pane role (`*Section.tsx`, `*Editor.tsx`, `*List.tsx`, `*Surface.tsx`, `*Details.tsx`) are compared against their own role cohort, not against the panes.
- If the area has no scaffold and the panes are already inconsistent, that is a pre-existing gap. Note it once; do not block the PR for inheriting it.
- Divider rhythm is owned by `SettingsGroup`, not by the pane. A pane hand-drawing hairlines between rows is a check-1 finding, not a check-8 one.

---

## Reporting

One entry per finding:

```
[check N] <path>:<line>
  job:      paint | anatomy | state | behavior
  rule:     <the doctrine sentence being applied>
  evidence: <the signature output, and for check 2 the other call sites>
  ask:      <promote to <tier> / compose <Component> / add a sanction comment / adopt the scaffold value>
```

Then a header block with the counts per check and, explicitly, the checks that ran clean. Close with the carve-outs you applied and why, so the author can see what was *not* charged to them - a silent suppression is indistinguishable from a missed check.

State the residual risk honestly: checks 1, 2, 6 (lookalike-primitive half) and 8 are judgment calls where a signature can only nominate candidates. None of the eight is CI-enforced today (Current Gaps).

---

## Appendix - signature validation

Validated 2026-08-12 against `origin/main` at `cb8edce4d`, one commit after the doctrine merged (#1779).

### Hit rate on the known gaps still in the tree

Each signature was run against the tree and scored against the violations named in `specs/DESIGN_SYSTEM.md § Current Gaps`.

| Check | Signature | Doctrine claim | Measured | Verdict |
| --- | --- | --- | --- | --- |
| 1 | index-row completeness over `$LIB` | (not itemised) | 7 raw hits, 6 absorbed by carve-outs (5 `secrets/*` internals, 1 `utils/`), leaving `TypewriterRevealText.tsx` - a real un-indexed primitive with a live consumer (`ChromeWorkspaceTab`) and a registry entry | HIT, plus one gap the doctrine had not recorded |
| 2 | paint-fingerprint index, `--tree --min-files 2` | "several duplicated shapes (roster rows, card shells, status dots, disclosure state machines) pending promotion" | 29 fingerprints in 2+ files after the neutralizer filter; top cluster `bg-card border border-border rounded-lg` in 9 files; two byte-identical cross-file pairs (`AccountPane`/`OrganizationPane` notice, `ApiKeyCreatorModal`/`SecretEditorDialog` inline error) | HIT |
| 2 | dead-component scan | "`AuthProviderButton` and `ListRow` have no product call sites" | exactly those two, plus `RangeSlider` (a third the doctrine had not recorded). `ProductNotice` confirmed separately: zero call sites, and its `rounded-lg border` + tone map is hand-rolled at 5+ feature sites | HIT (2/2 named, +1) |
| 3 | `role="dialog\|alertdialog\|menu\|listbox\|tooltip"` outside `primitives/`, tests excluded | "seven hand-rolled overlay shells" | exactly 7: `PaneSideOverlay`, `OpenTargetMenu`, `ComposerInlineMenu`, `SelectedResponseActionMenu`, `DelegatedAgentHoverCard`, `FileTreeOverlay`, `PublishDialog` | HIT (7/7) |
| 4 | ungated bracket families, `[var(` and grid excluded | "arbitrary width/height/padding/margin/inset brackets have no gate rule" | 173 sites in feature code; top literals `py-[13px]` x17, `h-[46px]` x10, `w-[18px]` x8. Sanction comments exist at a handful of sites (e.g. `ComposerInlineMenu` max-height), proving the convention has precedent | HIT |
| 5 | lucide identifier-set diff | "direct `lucide-react` imports in ~43 feature files (33 of them shadowing at least one identically named tuned glyph)" | 49 files, 36 shadowing, against 158 exported glyph names in `primitives/icons/`. The tree has drifted up from the doctrine's approximation; the shape of the claim holds | HIT (counts refreshed) |
| 6 | `<button\|input\|label\|select\|textarea` outside `primitives/` | mechanical gate, expected clean | 1 raw hit, and it is a code comment - the gate is genuinely green tree-wide. `React.createElement("button")` evasions: 0 | CLEAN (as expected) |
| 7 | state-utility classifier, HARD vs SOFT | "no gate detects a hand-assembled stack ... hundreds of such stacks predate the rule" | 474 state utilities in feature code, of which 69 off-vocabulary across 49 files. Top offenders are the exact ones the specs name: `hover:bg-muted` x15 (banned by styling.md), `hover:bg-hover/30` x2 (styling.md's own anti-example), `hover:opacity-65`/`focus-visible:opacity-65` (the banned partial-opacity glyph transition) | HIT - and the 405 sanctioned uses are correctly suppressed |
| 8 | pane-root rhythm census | (not itemised) | settings panes: 20 roots at `space-y-6`, 3 `repo/*Pane.tsx` at `space-y-5`, 1 at `space-y-1.5` - a live drift of exactly the kind the doctrine describes | HIT |

### False positives on two recently merged control PRs

Controls: **#1777** `feat(product): settings wash restyle` (43 files, heaviest recent UI PR, base `44da7da2`, head `6918b943`) and **#1778** `fix(product): delete closed sessions from the history popover` (12 files, base `df256b84`, head `271f07a8`).

| Check | #1777 raw | #1777 after carve-outs and grouping | #1778 raw | #1778 after | Assessment |
| --- | --- | --- | --- | --- | --- |
| 1 (redraw tell) | 1 | 1 note - a warning banner card that duplicates `HarnessConfigIssueBanner`'s shape | 0 | 0 | true positive |
| 2 | 1 | 1 note - table-header row shape shared with `BillingPlanComparison` | 0 | 0 | true positive, low severity |
| 3 | 0 | 0 | 0 | 0 | clean |
| 4 | 22 lines | 4 grouped literals (grid-positioning brackets excluded): `py-[13px]` x15 across 10 files (strong - a new hand-tuned row height with no token and no comment, and simultaneously the check-2 settings-row duplicate), `py-[30px]` x2, `min-h-[5.25rem]` x2, `lg:w-[22rem]` x1 | 0 | 0 | 1 strong + 3 notes; no false positives, but the grouping step is load-bearing |
| 5 (naive `^+.*lucide-react`) | 1 | - | 0 | - | **false positive** - the line only *removed* `KeyRound`. This is why the naive grep was replaced. |
| 5 (identifier-set diff) | 0 | 0 | 0 | 0 | clean - the tuned signature |
| 6 | 0 | 0 | 0 | 0 | clean |
| 7 (naive `hover:\|active:\|focus-visible:`) | 4 | - | 3 | - | 7 undifferentiated candidates |
| 7 (HARD/SOFT classifier) | 0 HARD / 4 SOFT | 0 findings - all four are `hover:bg-hover active:bg-active hover:text-foreground` on first-instance rows | 1 HARD / 2 SOFT | 1 finding - `hover:bg-destructive/10` (ad-hoc alpha overlay; the companion `hover:text-destructive` is correctly suppressed as colour promotion) | true positive |
| 8 (naive `^+.*space-y-`) | 7 | - | 0 | - | all seven are intra-pattern spacing inside rows and cards |
| 8 (pane-root scoped) | 10 panes read | 0 - nine sit at the `space-y-6` mode; `RepoActionsPane` sits at `space-y-5`, but that drift predates the PR and is one of the three known repo-pane outliers | 0 panes touched | 0 | clean - the tuned signature, with the pre-existing-drift carve-out doing real work |

**Totals after tuning: 0 false positives across both control PRs.** Six candidate findings survive on #1777 and one on #1778, and every one of them is a genuine, defensible conformance observation against a merged PR - which is the expected outcome, since none of these eight checks was enforced when those PRs were reviewed.

Three naive spellings were measured and discarded because they *did* produce false positives: `^+.*lucide-react` (1 FP on #1777), the undifferentiated state-utility keyword (7 undifferentiated candidates, 6 of them sanctioned), and `^+.*space-y-` (7 FPs on #1777). Those are recorded above rather than deleted, so the tuning is auditable.

### Tuning decisions and why

1. **Check 5 must diff identifier sets, not lines.** A shrinking lucide import line matches `^+.*lucide-react`. Negative control: run the tuned script over `e93d98636~1..e93d98636` (#1744) and it correctly reports 5 new identifiers across two files.
2. **Check 7 needs a vocabulary, not a keyword.** 474 of 474 state utilities match the naive keyword; only 69 are off-vocabulary. The sanctioned set encodes the shared state fills, the hover-reveal idiom, neutralization, the focus ring, and bare-semantic colour promotion - with the deliberate line that `hover:text-destructive` is promotion while `hover:bg-destructive/10` is an ad-hoc overlay.
3. **Check 2 fingerprints paint, not the whole class string.** Keeping layout classes makes every near-copy unique and the detector finds nothing; dropping them makes rows that differ only in gap match, which is the doctrine's own definition of shape identity. All-neutralizer fingerprints are dropped, which removed the 8-file `bg-transparent border-0 shadow-none` cluster.
4. **Check 4 is scoped to the ungated families and grouped by literal.** Un-grouped it produced 21 lines on #1777 for what is really one decision repeated eleven times.
5. **Check 8 is scoped to the pane root by indentation and role suffix.** Un-scoped it produced 7 intra-pattern hits on #1777, none of them rhythm.

### Reproducing

```bash
gh pr diff 1777 > /tmp/pr1777.diff && gh pr diff 1778 > /tmp/pr1778.diff
git fetch origin pull/1777/head pull/1778/head --quiet
SIG=.claude/skills/ui-conformance-review/signatures.py
python3 "$SIG" dupes  --tree --min-files 2
python3 "$SIG" dupes  --diff /tmp/pr1777.diff
python3 "$SIG" states --diff /tmp/pr1778.diff
python3 "$SIG" lucide --base 44da7da20abd5dad6f75cecf4d7a0b5294a7829b --head 6918b9438107214d5b71160ffb0691d269406100
python3 "$SIG" lucide --base e93d98636~1 --head e93d98636   # negative control: expects 5
```
