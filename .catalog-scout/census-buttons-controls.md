# Buttons + Controls census

Scope: apps/packages/ui/src, apps/packages/product-ui/src, apps/packages/product-client/src,
apps/desktop/src. Tests excluded. Playground included only to flag clones of production patterns.
Head: b395def3c (ui-foundation).

Overall picture: the button/control layer is in unusually good shape already. `Button`
(`apps/packages/ui/src/primitives/Button.tsx`) is the one real base — every icon button, tab
button, pill, toggle, and segmented-control cell in product-ui/product-client is built by either
composing `Button` with `variant="unstyled"|"ghost"` or by wrapping the layout-level
`IconButton`/`RowActionIconButton`. Zero raw `<button>` elements exist in product-ui; exactly one
in product-client (a legitimate `<div>`-vs-`<button>` DOM-nesting guard); zero in desktop (desktop
has no bespoke controls at all — it is a pure consumer of product-ui/product-client). The residual
duplication is concentrated in **tabs** (four independently-built tab-strip families that never
converged on `primitives/Tabs.tsx`, which is dead) and in a few small pill/dot glyph variants that
look similar but encode genuinely different domain semantics.

---

## DUPLICATION FAMILY: Tab-strip implementations

Four unrelated "row of tab buttons" implementations exist, none of which import
`apps/packages/ui/src/primitives/Tabs.tsx` (adoption: 0 — see Singleton/dead-code note below).
Each grew its own tab-button markup because each has different DOM/drag/id requirements, but
they duplicate the same `role="tab"` / `aria-selected` / hover-active token recipe three or four
times over.

**Members:**

1. **`WorkspaceTabStrip` + `ChromeWorkspaceTab`** — `apps/packages/product-client/src/components/workspace/shell/tabs/WorkspaceTabStrip.tsx:7` (export `WorkspaceTabStrip`), `apps/packages/product-client/src/components/workspace/shell/tabs/ChromeWorkspaceTab.tsx:31` (export `ChromeWorkspaceTab`). The real workspace chat-tab strip (topbar). `WorkspaceTabStrip` is just a `role="tablist"` scroll shell; `ChromeWorkspaceTab` is the tab button itself, built from two `Button` (`variant="ghost"`) instances (label button `role="tab"` + close `Button`) inside a positioned `<div role="presentation">`. Has responsive collapse states (`isMini`/`isSmaller`/`isSmall`), drag-reorder support via absolute positioning + `translate3d`, per-tab close button, shortcut badge overlay, title mask-fade. Consumed by `HeaderChatTab.tsx` → `ChatTabWithMenu.tsx` → here.
2. **`RightPanelHeaderTabs`** — `apps/packages/product-client/src/components/workspace/shell/right-panel/RightPanelHeaderTabs.tsx:40`. Its own hand-rolled `role="tablist"` div (not `WorkspaceTabStrip`) wrapping `ToolHeaderButton.tsx:30` and `TerminalHeaderButton.tsx:25`/`TerminalHeaderIcon.tsx:38` — each a single `Button` (`variant="ghost" size="sm" role="tab"`) with a shared CSS class name (`ui-tab-system-tab`, defined in `apps/packages/design/src/css/product.css:1359`) rather than shared React markup. `ViewerHeaderButton.tsx:24` is the third sibling in this same family (file-viewer tab), same `Button role="tab"` + separate `IconButton` close, same `ui-tab-system-tab` CSS class.
3. **`SettingsScopeTabs`** — `apps/packages/product-ui/src/settings/SettingsScopeTabs.tsx:13`. Underline-style tabs (User/Org/Repo/Agents scope switcher). `role="tablist"` div of `Button` (`variant="unstyled" role="tab"`) with `border-b-2` underline active state — visually and structurally distinct from the pill/chrome tabs above (by design, per its own comment: "Flat: no pills").
4. **Playground clones** — `NavigationCloseTabs.tsx:7` and `FullFlowTabs.tsx` (`ParentTab`/`ChildTab`/`ArchivedTab`) + `FullFlowPrototype.tsx:251` inline tablist, all under `apps/packages/product-client/src/components/playground/subagents-ux/`. These are near-verbatim re-derivations of the `border bg-selected` tab-chip look with their own roving-focus keydown handler duplicated between `NavigationCloseTabs.tsx:27-43` and `FullFlowPrototype.tsx` (same 16-line arrow-key/Home/End block copy-pasted). They predate/parallel the real `ChromeWorkspaceTab` rather than reusing it, and re-implement roving tabindex from scratch instead of borrowing the production keydown handler.
5. **Dead primitive**: `apps/packages/ui/src/primitives/Tabs.tsx:18` (export `Tabs`) + its `TabButton` — a fully generic `role="tablist"` component with `items`/`activeId`/`onChange`. **Zero imports anywhere** in ui/product-ui/product-client/desktop (confirmed via `grep -rn "primitives/Tabs"` — only self-reference). It was added in the same foundation migration commit (`b680bc04e feat(ui): migrate foundation consumers`) as the rest of the new token vocabulary but nothing was ever migrated onto it.

**How they differ:**
- Chrome tabs (#1) need drag-reorder, responsive width collapse, and a title-mask fade — none of which the generic `Tabs` primitive or `SettingsScopeTabs` support.
- Right-panel tabs (#2) need `aria-grabbed`/reorderable drag state and a CSS-driven pill anatomy (`ui-tab-system-tab`) shared across three tool types (scratch/git/terminal/viewer), not React composition.
- `SettingsScopeTabs` (#3) is intentionally flat/underlined, a different visual language by design (documented in its own comment).
- Playground clones (#4) are copies of the chrome-tab visual recipe minus the collapse/drag machinery, plus a hand-rolled keydown handler that already exists once in production code paths (roving focus is not currently in `ChromeWorkspaceTab`/`ChatTabWithMenu` itself, so the playground actually explored a feature production doesn't have yet).

**Closest to canonical form:** None of the four are a drop-in canonical "Tabs" — they're all legitimately different enough (drag, collapse, CSS-driven vs component-driven anatomy, underline vs chrome). The generic `primitives/Tabs.tsx` is the one component that *should* be the canonical simple-tabs implementation for any future "just show N tabs, no drag" surface (SettingsScopeTabs's use case), but it wasn't reached for even there.

**Adoption count:**
- `WorkspaceTabStrip`/`ChromeWorkspaceTab`: 1 production surface (workspace header) + 1 playground page (`ChatPlaygroundPage.tsx`) = 2 files import `ChromeWorkspaceTab`.
- `RightPanelHeaderTabs` family: 1 production surface (right panel), 4 button variants (tool/terminal/terminal-editing/viewer).
- `SettingsScopeTabs`: 1 usage (`SettingsScreen.tsx`).
- Playground tab clones: 2 files, playground-only.
- `primitives/Tabs.tsx`: **0** usages anywhere.

**Consolidation recommendation:** Delete `apps/packages/ui/src/primitives/Tabs.tsx` (and its
package.json export) as unused, OR redirect `SettingsScopeTabs` to build on it if a shared
underline-tabs primitive is wanted (it's the only current caller-shape that would fit without
modification — it doesn't need drag/collapse). Keep `ChromeWorkspaceTab`/`RightPanelHeaderTabs` as
separate, justified implementations (real behavioral divergence: drag, collapse, CSS-anatomy).
Fold the playground `NavigationCloseTabs`/`FullFlowTabs` roving-focus keydown handler into a shared
hook (`useRovingTabFocus` or similar) instead of the current copy-paste — low priority since it's
playground-only, but worth doing before either prototype graduates.

---

## DUPLICATION FAMILY: Status dot / glyph mini-indicators

Five small "colored circle conveys state" components, each scoped to one domain, each reinventing
the dot/ring/pulse recipe independently rather than sharing one `StatusDot` primitive.

**Members:**
1. **`RecentWorkStatusDot`** — `apps/packages/product-ui/src/workspaces/RecentWorkStatusDot.tsx:10`. Tone-mapped (`attention|progress|success|danger|muted`) × surface-mapped (`default|sidebar`) span with `icon-status` sizing, optional `animate-pulse` for live state, optional label. Most complete API of the five (tone enum, surface variant, live-pulse, optional label, built-in `aria-label`+`title`).
2. **`PrStatusDot`** (+ `PrStatusIconOverlay`) — `apps/packages/product-ui/src/workspaces/PrStatusBadge.tsx:71` / `:105`. `size-1.5` dot, 7-way `PrStatusKind` tone map including a hollow/outline state (`pending`), with a corner-overlay composition mode for anchoring onto a row icon. Best a11y (`role="img"` + `aria-label` + optional native `title`, explicitly documented to avoid double-tooltip with a wrapping `Tooltip` primitive).
3. **`AutomationStatusGlyph`** — `apps/packages/product-ui/src/automations/AutomationStatusGlyph.tsx:19`. Not a dot at all — a hand-drawn SVG ring/progress-arc/pause-bar glyph per `AutomationInventoryStatusKind` (waiting/working/review/blocked/done), including an animated-looking dasharray "in progress" ring. Materially different rendering technique (SVG paths, not a CSS circle) because it needs a partial-progress ring, not just a filled/hollow dot.
4. **`HarnessStatusDot`** — `apps/packages/product-client/src/components/settings/sidebar/HarnessStatusDot.tsx:7`. Bespoke one-off: `size-2 rounded-full` + inline 3-way `bg-destructive|bg-warning` logic, with `null` returns for "no dot" states baked into the component instead of exposed as a tone. No `aria-label`/`title` at all — worst a11y of the five.
5. **Inline dot spans (no dedicated component)** — `apps/packages/product-client/src/components/workspace/shell/tabs/tab-rendering.tsx:67` (unread badge, `size-1.5 rounded-full ring-1 ring-background`) and `:119` (`icon-status rounded-full bg-info`); `apps/packages/product-client/src/components/workspace/chat/input/ComposerIntegrationsControl.tsx:60,150`; `apps/packages/product-client/src/components/feedback/UpdateRestartDialog.tsx:83-85` (animated ping-dot). None of these import any of #1-4 — each hand-writes its own `<span className="... rounded-full ...">`.

**How they differ:** #1/#2/#4 are all "filled-or-hollow circle, color = tone" — genuinely the same
shape family, but with three separate tone enums, three separate size conventions (`icon-status`
vs `size-1.5` vs `size-2`), and inconsistent a11y (only #1 and #2 label themselves; #4 and the
inline spans don't). #3 is legitimately different (progress-ring SVG, not appropriate to fold into
a plain-dot primitive). #5 are one-off inline spans that duplicate the *visual recipe* of #1/#2 with
zero reuse and zero labeling.

**Closest to canonical form:** `PrStatusDot` has the best a11y contract (explicit `role="img"` +
documented tooltip-collision handling) but the narrowest domain (7 PR-specific states).
`RecentWorkStatusDot` has the most general/reusable API shape (generic tone + surface + live-pulse
+ optional label) and already generalizes across "any status dot," making it the best base to
extract a shared `StatusDot` primitive from — its `tone`/`surface`/`live` props would need to grow
a `hollow` flag (already present) and a `size` prop to also cover `HarnessStatusDot`'s and the
inline spans' use cases.

**Adoption count:** `RecentWorkStatusDot`: 1 caller (`NewChatSurface.tsx`). `PrStatusDot`/`Overlay`:
2 callers (`ProductSidebarRepositories.tsx`, `WorkspacesCommandList.tsx`) + re-exported via
`PrStatusBadge` from `pr-status-presentation.ts`/`SidebarWorkspaceGitGlyph.tsx`/playground.
`AutomationStatusGlyph`: 3 callers (calendar view, inventory list, runs list). `HarnessStatusDot`:
1 caller (`SettingsSidebar.tsx`). Inline one-off spans: 4 files, 0 shared component.

**Consolidation recommendation:** Extract a shared `StatusDot` primitive into
`apps/packages/ui/src/primitives/` generalizing `RecentWorkStatusDot`'s tone/surface/live/hollow
API + `PrStatusDot`'s a11y contract (role="img", tooltip-collision-safe `withNativeTitle`); migrate
`HarnessStatusDot` and the four inline one-off dot spans (`tab-rendering.tsx`,
`ComposerIntegrationsControl.tsx`, `UpdateRestartDialog.tsx`) onto it. Keep `AutomationStatusGlyph`
separate — it's a progress-ring SVG, not a dot, and folding it in would force an awkward
polymorphic API for one caller. Keep `PrStatusDot`/`RecentWorkStatusDot` as domain-specific
thin wrappers over the shared primitive rather than deleting them (their tone-mapping logic is
domain knowledge worth keeping named).

---

## DUPLICATION FAMILY: Pill-shaped control buttons (composer vs generic)

Two visually-identical "icon + label + optional detail + trailing chevron, rounded-full, ghost
hover" pill buttons, forked because they live in different token universes (page chrome vs
composer-local color vars).

**Members:**
1. **`PillControlButton`** — `apps/packages/ui/src/primitives/PillControlButton.tsx:21`. Built on `Button` (`variant="ghost"`), uses standard semantic tokens (`text-muted-foreground`, `hover:bg-hover`, `data-[state=open]:bg-active`). `icon`/`label`/`detail`/`trailing`/`disclosure` (auto chevron) API.
2. **`ComposerControlButton`** — `apps/packages/ui/src/primitives/ComposerControlButton.tsx:21`. Same shape/API surface (`icon`/`label`/`detail`/`trailing`/`iconOnly`) but built on `Button` (`variant="ghost"`) with composer-scoped CSS custom-property colors (`--color-composer-control-hover`, `composer-control-foreground`/`-active-foreground`/`-muted-foreground`) instead of semantic tokens, plus an `emphasizeLabel` two-tone mode `PillControlButton` doesn't have. `LevelBarsButton` (`apps/packages/ui/src/primitives/LevelBarsButton.tsx:116`) is a specialized wrapper *around* `ComposerControlButton` for the reasoning-effort bar-ladder icon.

**How they differ:** Purely a token-scope split (page chrome vs composer surface), not a behavioral
one — the prop shapes are almost identical (`icon`, `label`, `detail`, `trailing`, an icon-only
mode). `ComposerControlButton` additionally has `emphasizeLabel` (two-tone value hierarchy) which
`PillControlButton` lacks.

**Closest to canonical form:** Neither should absorb the other — the composer surface deliberately
uses a separate CSS-variable palette (`--color-composer-control-*`) so composer chrome can be
restyled independently of app-wide `--color-hover`/`--color-active`, which is a real design
decision (documented via the composer-specific tokens), not an accident.

**Adoption count:** `PillControlButton`: 3 callers (`AutomationRunLocationSelector.tsx`,
`AutomationAgentRunConfigPicker.tsx`, `AutomationEditorControls.tsx`). `ComposerControlButton`: 17
callers (composer controls: fast-mode toggle, model config, reasoning effort, etc.) +
`LevelBarsButton` (1 caller: `ComposerModelConfigControl`-family).

**Consolidation recommendation:** Keep both — genuinely different token scopes by design, and the
prop-shape overlap is small enough (4-5 shared props) that a shared base would add an abstraction
layer for no real duplication reduction. No action.

---

## SINGLETON: `Button` — `apps/packages/ui/src/primitives/Button.tsx:52`
The one true base button. 9 variants (`primary/secondary/outline/ghost/destructive/inverted/
sidebar/sidebar-link/unstyled`) × 6 sizes (`sm/md/pill/icon/icon-sm/unstyled`), built-in `loading`
state with `Spinner`. Adoption: 59 files in product-ui, 177 in product-client, 0 in desktop
(consumes via product-ui/product-client). Canonical, sanctioned, no rival.

## SINGLETON: `IconButton` — `apps/packages/ui/src/primitives/IconButton.tsx:33`
Icon-only button for chrome contexts that don't fit `Button`'s icon-sm circle (square corners,
`tone` = `default|sidebar`, `size` = `xs|sm|md`). Adoption: 21 direct importers across product-ui
(4) and product-client (17, e.g. `TerminalTopBar`, `CoworkWorkspaceHeader`, `RightPanelHeaderActions`,
`TerminalHeaderIcon`/`ViewerHeaderButton` tab-close buttons). Not merged into `Button` because it
serves a different corner-radius/no-loading-state niche that `RowActionIconButton` builds on top of.

## SINGLETON: `RowActionIconButton` (+ `RowActionIndicator`) — `apps/packages/ui/src/layout/RowActionIconButton.tsx:29`
The canonical hover-reveal row action icon button (built on `IconButton`), explicitly named as the
absorption target in the charter. Confirmed it has in fact absorbed all row-hover icon-button call
sites checked (`WorkspaceInventoryRow`, `AutomationInventoryList`, `AutomationRunsList`,
`HomeOnboardingCards`, `PlanReferenceAttachmentCard`, `WorkspaceItemMenu`,
`ProductSidebarActionButton`/`SidebarActionIconButton`). No remaining bespoke
`group-hover:opacity-100` icon-button implementations were found outside this family (grep swept
clean). Adoption: 8 non-test/non-self files across product-ui (4) + product-client (3) + its own
`SidebarActionButton` wrapper.

## SINGLETON: `SidebarActionButton` — `apps/packages/ui/src/layout/SidebarActionButton.tsx:18`
Thin `RowActionIconButton` wrapper adding sidebar-scoped tone + a `variant="section"` (always-
visible, dimmed) mode. Correctly built on top of, not parallel to, `RowActionIconButton`. Adoption:
4 usage sites (sidebar rows/sections).

## SINGLETON: `PaneIconButton` — `apps/packages/ui/src/layout/PaneIconButton.tsx:14`
Small `Button` (`variant="ghost" size="icon-sm"`) wrapper for pane-header icon buttons (right-panel
chrome), sidebar-toned. Different niche from `RowActionIconButton` (not hover-reveal; always
visible pane-header chrome) — correctly not merged. Adoption: 4 usage sites.

## SINGLETON: `ComposerActionButton` — `apps/packages/ui/src/primitives/ComposerActionButton.tsx:10`
The 28px solid-circle send/stop button (`Button` `variant="ghost" size="icon-sm"` + composer-send
color tokens). Single well-defined role, not a generic icon button. Adoption: 2 sites (send/stop).

## SINGLETON: `SplitButton` — `apps/packages/product-client/src/components/workspace/open-target/SplitButton.tsx:18`
The one split-button implementation in the domain (primary action + chevron-menu secondary target
picker), used for "Open in..." actions. Built from two `Button` (`variant="unstyled"`) instances +
`OpenTargetMenu`. No rival split-button implementation found anywhere in scope.

## SINGLETON: `SegmentedControl` — `apps/packages/ui/src/primitives/SegmentedControl.tsx:19`
Generic `role="radiogroup"` segmented control (bordered, `bg-selected` active cell). Adoption: 7
sites (`SecretEditorDialog`, `RepoScopeHeaderControls`, `AgentScopeHeaderControls`,
`OrganizationBudgetsPane`, 2 playground surfaces, `AgentsPlaygroundPage`). No rival implementation —
`AutomationSurface`'s `ViewModeTabs` (`AutomationSurface.tsx:143`) looks similar (pill row, active
state) but uses `aria-pressed` toggle-buttons semantics rather than `radiogroup`/`radio`, a
deliberate (if perhaps under-considered) semantic choice for a 2-item List/Calendar view switch —
worth a follow-up look at whether it should be a `SegmentedControl` instead, but it is not close
enough in API shape to count as a duplication family member.

## SINGLETON: `Switch` — `apps/packages/ui/src/primitives/Switch.tsx:9`
`role="switch"` toggle track+thumb, `size="default"|"compact"`. Well adopted: 10 files (model
config, org settings panes, appearance, publish dialog, harness auth). One rogue re-implementation
exists: `AutomationSurface.tsx`'s `IncludePausedSwitch` (`AutomationSurface.tsx:183`) hand-rolls
`role="switch"` + its own track/thumb spans on a `Button` instead of using the `Switch` primitive —
flagged here as a **near-miss duplication** worth folding into `Switch` (same semantics: boolean
toggle with label, just laid out label-then-switch instead of switch-alone). Low-cost fix: swap
`IncludePausedSwitch`'s hand-rolled track for `<Switch checked={checked} onChange={onChange} size="compact" />` wrapped in the existing label span.

## SINGLETON: `Checkbox` (kit, Radix-backed) — `apps/packages/ui/src/kit/Checkbox.tsx:7`, re-exported at `apps/packages/ui/src/primitives/Checkbox.tsx:1`
Radix `CheckboxPrimitive` wrapper, `data-[state=checked]` styling, `Check` icon indicator. Good a11y
(Radix-native). Adoption: 11 sites (workflows, integrations, support, publish dialog, feedback).
No rival raw-checkbox implementation found — `role="checkbox"` grep returned zero hits outside this
component. The `primitives/Checkbox.tsx` re-export is a harmless one-line indirection, not a fork.

## SINGLETON: `RadioGroup`/`RadioGroupItem` (kit, Radix-backed) — `apps/packages/ui/src/kit/RadioGroup.tsx:6,19`
Radix `RadioGroupPrimitive` wrapper. Adoption: only consumed internally by `ContextMenu.tsx` and
`DropdownMenu.tsx` (menu radio items) — **zero direct product-ui/product-client usage** for an
actual standalone radio-group UI. Not currently a duplication risk since `RadioCardGroup` (below)
independently covers the one place the domain wants radio-semantics rows; flagging only as "unused
outside menus" for awareness, not as a fix-now item.

## SINGLETON: `RadioCardGroup` — `apps/packages/ui/src/primitives/RadioCardGroup.tsx:21`
Card-style radio group (icon + label + description, checkmark badge), hand-rolled `role="radio"`
buttons rather than Radix `RadioGroupItem`. Adoption: 1 site (`WorkspaceAvailabilityActionHost`'s
link-candidate picker). Functionally could have been built on Radix `RadioGroup`/`RadioGroupItem`
(above) instead of duplicating `role="radio"`/`aria-checked` by hand, but since `RadioGroup` itself
has zero non-menu adoption, this isn't yet a "two implementations competing for the same call site"
problem — just a missed opportunity to consolidate on the Radix primitive. Noting, not flagging as
urgent.

## SINGLETON: `SelectionRow` — `apps/packages/ui/src/primitives/SelectionRow.tsx:14`
Full-width selectable row (icon + label/subtitle + trailing check-badge), also hand-rolled
`role="radio"`. **Zero adoption found** outside its own file — no callers in product-ui,
product-client, or desktop. Candidate for deletion or for the charter's "narrow the set" step:
either use it somewhere or cut it. Listed here rather than as a duplication family because it has
no live rival to compare against, but it's effectively dead code sharing the exact same
icon+label+trailing-badge shape as `RadioCardGroup` (a horizontal card) — if it were needed, this
is likely where a `PillControlButton`/`RadioCardGroup`-style consolidation would land.

## SINGLETON: `Toggle` — `apps/packages/ui/src/primitives/Toggle.tsx:8`
Generic `aria-pressed` toggle button (`bg-selected` when pressed). **Zero adoption anywhere** —
confirmed via `grep -rn "primitives/Toggle"` returning only the self-reference. Dead code, added in
the same foundation-migration commit as `Tabs.tsx` and never wired up. `AutomationSurface`'s
`ViewModeTabs` buttons use `aria-pressed` by hand (see above) and would have been a natural fit for
this primitive instead.

## SINGLETON: `Badge` — `apps/packages/ui/src/primitives/Badge.tsx:27`
Generic tone-mapped pill badge (7 tones incl. `sidebar`). Well adopted: 30 files. No rival plain
badge implementation found; chips/dots/glyphs above are all more specialized (icon+label clusters,
or bare dots) rather than competing with this shape.

## SINGLETON: `AuthProviderButton` — `apps/packages/ui/src/primitives/AuthProviderButton.tsx:11`
Full-width OAuth-provider button (icon + label + loading spinner), one of the few primitives that
is a raw `<button>` rather than built on `Button` (defensible: it needs a distinct 44px/rounded-lg
shape and `primary|secondary` variants unrelated to `Button`'s variant set). Adoption: 2 sites (auth
start panel providers). No rival implementation.

## SINGLETON: `PopoverButton` — `apps/packages/ui/src/primitives/PopoverButton.tsx:54`
Not a "control" in the strict button-family sense but included since so many pill/chip/tab
controls above use it as their disclosure mechanism. Adoption: 51 files — the single most-reused
primitive checked in this census. No rival popover-trigger-button implementation found.

## SINGLETON: `TabGroupPill`/`HeaderGroupPillTab` — `apps/packages/product-client/src/components/workspace/shell/tabs/TabGroupPill.tsx:4`, `.../topbar/HeaderGroupPillTab.tsx:26`
Manual/subagent tab-group collapse pill, built cleanly on `Button` (`variant="ghost" size="sm"`).
One implementation, no rival. Listed for coverage since it lives in the tab-strip neighborhood but
is not a duplicate of any tab-button family above (different role: group header, not a tab).

## SINGLETON: `HunkActionPill` — `apps/packages/product-client/src/components/content/ui/diff/HunkActionPill.tsx`
Despite the "Pill" name, this is a small cluster of `Button` (`variant="ghost" size="icon-sm"`)
instances (revert/stage/unstage), not a rival to `PillControlButton`/`ComposerControlButton`. Not a
duplication — correctly composed from the canonical `Button`.

## SINGLETON: `SidebarUpdatePill` — `apps/packages/product-client/src/components/workspace/shell/sidebar/SidebarUpdatePill.tsx:73`
One-off morphing status pill (download/ready/armed states) built on `Button` (`variant="unstyled"`)
with its own progress-ring SVG. Single call site, single purpose, no rival.

---

## Notes on desktop (`apps/desktop/src`)
Confirmed zero raw `<button>` elements and zero direct imports of `@proliferate/ui/primitives/
Button` in `apps/desktop/src` — the desktop app shell (window chrome, auth bootstrap, Tauri access
layer) contains no bespoke button/control UI of its own; all product surfaces are supplied by
product-client/product-ui. Nothing to catalog in this domain for desktop beyond "correctly has
none."

## Summary of concrete follow-ups (severity order)
1. **Delete dead primitives**: `primitives/Tabs.tsx` and `primitives/Toggle.tsx` — zero adoption,
   confirmed via full-repo grep, both from the same unmigrated foundation commit.
2. **Fold `AutomationSurface`'s hand-rolled `IncludePausedSwitch`** onto the `Switch` primitive —
   same semantics, needless reimplementation of track/thumb spans.
3. **Consider `AutomationSurface`'s `ViewModeTabs`** (`aria-pressed` List/Calendar switch) as a
   `SegmentedControl` or `Toggle` usage instead of hand-rolled `Button`+`aria-pressed` — would also
   give `Toggle` its first real caller if kept instead of deleted.
2b. Alternatively, if `Toggle` is deleted per #1, migrate `ViewModeTabs` to `SegmentedControl`
   instead (2-item radiogroup is a reasonable fit) and drop the manual `aria-pressed` pattern.
4. **Extract a shared `StatusDot` primitive** generalizing `RecentWorkStatusDot` + `PrStatusDot`,
   and migrate `HarnessStatusDot` plus the four inline one-off dot spans onto it (see status-dot
   family above for exact call sites).
5. **`SelectionRow`** has zero callers — either use it or cut it per the charter's "narrow the set."
6. (Low priority, playground-only) De-duplicate the roving-tabindex keydown handler copy-pasted
   between `NavigationCloseTabs.tsx` and `FullFlowPrototype.tsx`.

No changes recommended for: `Button`, `IconButton`, `RowActionIconButton`, `SidebarActionButton`,
`PaneIconButton`, `ComposerActionButton`, `ComposerControlButton`/`PillControlButton` (kept
separate, justified token-scope split), `SegmentedControl`, `Checkbox`, `Switch` (aside from the one
rogue caller above), `Badge`, `AuthProviderButton`, `PopoverButton`, `SplitButton`,
`ChromeWorkspaceTab`/`WorkspaceTabStrip`, `RightPanelHeaderTabs` family, `SettingsScopeTabs`,
`TabGroupPill`, `HunkActionPill`, `SidebarUpdatePill`.
