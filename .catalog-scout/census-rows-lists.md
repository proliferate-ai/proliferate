# Component-duplication census — ROWS + LISTS + TREES

Scope: `apps/packages/ui/src`, `apps/packages/product-ui/src`,
`apps/packages/product-client/src`, `apps/desktop/src`. Tests excluded.
Playground excluded except where it clones a production pattern (none found —
the one playground row usage inspected, `WorkspaceStatusPlayground.tsx`,
imports the real `ProductSidebarSectionHeader`, not a clone).
Head: `b395def3c` (ui-foundation-target).

`apps/desktop/src` has no row/list/tree/menu components of its own — it only
consumes `product-ui`/`product-client`. Domain coverage below is therefore
entirely in `ui` + `product-ui` + `product-client`.

Adoption counts are `grep -rl` file counts of real component usages (imports
+ JSX), excluding the defining file and `*.test.*`.

---

## FAMILY 1 — Generic interactive row surface (icon/status + label/subtitle + trailing)

The prime target named in the brief: independent implementations of
"icon + label + meta + trailing action" row anatomy, outside the sidebar
(sidebar has its own converged family, #2 below).

| # | Member | Package:file:line | Export | Adoption |
|---|---|---|---|---|
| 1 | `ListRow` | `apps/packages/ui/src/layout/ListRow.tsx:11` | `ListRow` | 1 (`WorkspaceRow` in product-ui/workspaces) |
| 2 | `SelectionRow` | `apps/packages/ui/src/primitives/SelectionRow.tsx:14` | `SelectionRow` | **0 — dead code** |
| 3 | `InventoryRow` (workspace inventory) | `apps/packages/product-ui/src/workspaces/WorkspaceInventoryRow.tsx:10` | `InventoryRow` | 1 |
| 4 | `AutomationInventoryRow` | `apps/packages/product-ui/src/automations/AutomationInventoryList.tsx:65` | (local, not exported) | 1 (used inline in same file) |
| 5 | `AutomationRunRow` | `apps/packages/product-ui/src/automations/AutomationRunsList.tsx:51` | (local) | 1 |
| 6 | `ConnectedProviderRow` | `apps/packages/product-ui/src/account/ConnectedProviderRow.tsx:12` | `ConnectedProviderRow` | 0 external — defined, unused outside its own file (dead-ish) |
| 7 | `SecretRow` | `apps/packages/product-ui/src/secrets/SecretRow.tsx:13` | `SecretRow` | 1 (`SecretList`) |
| 8 | `IntegrationRow` | `apps/packages/product-client/src/components/settings/panes/integrations/IntegrationRow.tsx:23` | `IntegrationRow` | 1 |
| 9 | `HarnessAuthApiKeyRow` | `apps/packages/product-client/src/components/settings/panes/agents/harness/HarnessAuthApiKeyRow.tsx:27` | `HarnessAuthApiKeyRow` | 1 |
| 10 | `CoworkArtifactRow` | `apps/packages/product-client/src/components/workspace/cowork/CoworkArtifactRow.tsx:12` | `CoworkArtifactRow` | uses `SidebarRowSurface` (family #2) directly — a *consumer*, not an independent anatomy |
| 11 | `MemberRow`/`InvitationRow` (org members) | `apps/packages/product-client/src/components/settings/panes/organization/OrganizationMembersList.tsx:88` | local | 1 (own grid, `PEOPLE_GRID_CLASS`) |

**How they differ:**
- Structural container: `ListRow` and `SelectionRow` are `<button>`-rooted with a fixed `leading/title+description/trailing` slot API. `InventoryRow`/`AutomationInventoryRow`/`AutomationRunRow` are **CSS-grid**-rooted (`grid-cols-[18px_...]`) with responsive breakpoint columns (`sm:`/`md:`/`lg:`) and a shared local `MetadataCell` helper **copy-pasted identically** into both `WorkspaceInventoryRow.tsx` and `AutomationInventoryList.tsx`/`AutomationRunsList.tsx` (three near-identical `MetadataCell` definitions, byte-for-byte the same 8-line function).
- `ConnectedProviderRow` and `SecretRow` and `IntegrationRow` are flex-rooted `<div>` (non-interactive) rows with `border-b border-border-light last:border-b-0` hairlines — a third dividing convention (vs. grid rows' no-hairline and `ListRow`'s own `border-b border-border-light` — actually `ListRow` shares the hairline convention with these three, but is a `<button>` not a `<div>`).
- Selection state: only `SelectionRow` renders a radio-style trailing check circle; none of the others share a selected-row visual with it.
- a11y: `InventoryRow`/`AutomationInventoryRow`/`AutomationRunRow` build a full `aria-label` sentence from every visible field (best-in-class a11y — see `buildRowAriaLabel`/`automationRowAriaLabel`/`runRowAriaLabel`, three separately-hand-written but structurally identical label-builder functions). `ListRow`, `SecretRow`, `ConnectedProviderRow`, `IntegrationRow` have no row-level `aria-label` at all (rely on visible text only).
- Token vocabulary: all use the new tokens (`text-ui`, `text-ui-sm`, `bg-hover`, `bg-active`, `bg-selected`) — none is stale.
- Trailing action pattern: `InventoryRow`/`AutomationRunRow` use the shared `RowActionIndicator` (ui/src/layout/RowActionIconButton.tsx) for the reveal-on-hover external-open glyph; `AutomationInventoryRow` reinvents the same reveal-on-hover affordance with a hand-rolled absolutely-positioned popover menu (`AutomationActionMenu`, lines 159–257) instead of the kit `DropdownMenu` or `PopoverButton` — its own bespoke click-outside/Escape handling, `MenuAction` button, duplicate of what `PopoverMenuItem`/`DropdownMenuItem` already do.

**Closest to canonical:** the **grid-row shape used by `InventoryRow` (workspace inventory)** is the most complete API (responsive columns, full aria-label, `RowActionIndicator` reuse, active-row `bg-selected`) and should be the template. `ListRow` is the closest to a real generic primitive (clean flex API, sits in `ui/src/layout`) but is only adopted once and lacks the grid-column responsive-collapse pattern the inventory rows need.

**Consolidation recommendations:**
- Extract the three copy-pasted `MetadataCell` functions (`WorkspaceInventoryRow.tsx`, `AutomationInventoryList.tsx`, `AutomationRunsList.tsx`) into one shared `ui`/`product-ui` component — same 8 lines, same className, three source-of-truth copies today.
- Extract the three copy-pasted `*RowAriaLabel` builder patterns into one shared "join defined fields with ', '" helper — not urgent (labels differ in domain fields) but the join/filter(Boolean) logic itself is duplicated 3×.
- Fold `AutomationActionMenu`'s hand-rolled popover into `PopoverButton` + `PopoverMenuItem` (or `DropdownMenu`) — delete the bespoke open-state/outside-click/Escape code (~60 lines).
- Delete `SelectionRow` (0 usages) — dead.
- `ConnectedProviderRow` has 0 usages outside its defining file — confirm dead and delete, or wire it up if intended for the account settings pane that doesn't exist yet.
- Keep `ListRow` as the generic flex-row primitive for simple button-rows (its one adopter, `WorkspaceRow`, is a legitimate simple case); keep the grid-row shape as the *other* canonical pattern for dense multi-column inventory rows — they serve genuinely different layouts (simple 1-line list vs. dense filterable inventory table-as-rows), so two patterns is defensible, but the grid one needs its `MetadataCell`/aria-label helpers unified across its three current copies.

---

## FAMILY 2 — Sidebar row surface (converged, mostly healthy)

| # | Member | Package:file:line | Export | Adoption |
|---|---|---|---|---|
| 1 | `SidebarRowSurface` (base primitive) | `apps/packages/ui/src/layout/SidebarRowSurface.tsx:13` | `SidebarRowSurface` | 6 files (`ProductSidebarThreads`, `ProductSidebarRepositories`, `SettingsShell`, `CoworkArtifactRow`, `CoworkManagedWorkspaceList`, `WorkspaceCleanupAttentionSection`) |
| 2 | `SidebarNavRow` (built on #1) | `apps/packages/ui/src/layout/SidebarNavRow.tsx:17` | `SidebarNavRow` | 2 (`ProductSidebarNavigation`, `SettingsSidebar`) |
| 3 | `ProductSidebarThreadRow` (built on #1) | `apps/packages/product-ui/src/sidebar/ProductSidebarThreads.tsx:29` | `ProductSidebarThreadRow` | 4 (incl. `CoworkThreadRow`) |
| 4 | `ProductSidebarWorkspaceRow` (built on #1) | `apps/packages/product-ui/src/sidebar/ProductSidebarRepositories.tsx:117` | `ProductSidebarWorkspaceRow` | 4 |
| 5 | `ProductSidebarRepoGroupHeader` (built on #1) | `apps/packages/product-ui/src/sidebar/ProductSidebarRepositories.tsx:20` | `ProductSidebarRepoGroupHeader` | 3 |
| 6 | `SidebarNavItem` (standalone, NOT built on #1) | `apps/packages/ui/src/layout/SidebarNavItem.tsx:9` | `SidebarNavItem` | **0 — dead code** (only `SidebarNavItemView`, an unrelated *type*, is imported anywhere) |

**How they differ:** `#1–5` all correctly funnel through the shared `SidebarRowSurface` primitive (active/hover/disabled states, `bg-selected`/`bg-hover`/`bg-active`, focus ring, keyboard Enter/Space) — this is the healthy, already-consolidated case. `#6 SidebarNavItem` predates that consolidation: it reimplements its own active/hover state (`h-8`, `rounded-md`, same `bg-selected`/`hover:bg-hover` tokens but a different height/radius than `SidebarRowSurface`'s `rounded-sm`/28px rows) and is a straight competitor to `SidebarNavRow`, just orphaned.

**Closest to canonical:** `SidebarRowSurface` + its four real consumers — already correct, new token vocabulary, best a11y (role, aria-disabled, aria-expanded, keyboard handling centralized once).

**Consolidation recommendation:** delete `SidebarNavItem.tsx` — 0 usages, fully superseded by `SidebarNavRow`/`SidebarRowSurface`. Everything else in this family: keep as-is, it's the reference pattern the rest of the domain should imitate.

---

## FAMILY 3 — Roster row (activity sidebar): SubagentRosterRow vs TerminalRosterRow

| # | Member | Package:file:line | Export | Adoption |
|---|---|---|---|---|
| 1 | `SubagentRosterRow` | `apps/packages/product-ui/src/activity/SubagentRosterRow.tsx:35` | `SubagentRosterRow` | 1 (`AgentsRosterPanel`) |
| 2 | `TerminalRosterRow` | `apps/packages/product-ui/src/activity/TerminalRosterRow.tsx:35` | `TerminalRosterRow` | 1 (`LiveTerminalsRosterPanel`) |

**How they differ:** structurally identical — icon (`GitFork` vs `SquareTerminal`) + title line + a `flex flex-wrap gap-x-1.5` meta row of `·`-separated spans + optional `Button`-wrapped variant when `onOpen` is passed, with the exact same `flex w-full items-start gap-2 rounded-md px-1.5 py-1.5 text-left text-ui` className duplicated verbatim in both files (including the `if (!onOpen) { … } return <Button …>` branch, byte-identical except tag/domain fields). Only real difference: tone-map keys (`SubagentTone` has 3 values, `ProcessTone` has 4 — an extra `muted`), and the domain fields shown (model/background/duration vs pid/cwd/elapsed).

**Closest to canonical:** neither is more complete than the other; both are equally well-formed. This is a textbook "extract a shared `RosterRow` primitive with icon/tone, title, and a meta-parts array" case — the `·`-joined meta row alone is worth factoring out (same pattern also appears hand-rolled in `ProductSidebarThreadRow`'s `subtitle`/`detail` fields and in `SubagentRosterRow`/`TerminalRosterRow`).

**Consolidation recommendation:** extract a shared `RosterRow` (icon, tone, title, `meta: ReactNode[]` joined with `·`, optional `onOpen`) into `product-ui/activity/`; fold both `SubagentRosterRow` and `TerminalRosterRow` into thin wrappers that supply icon/tone-map/fields. ~90% of both files' code is identical scaffolding today.

---

## FAMILY 4 — Menu-item row (popover/dropdown/context menu)

| # | Member | Package:file:line | Export | Adoption |
|---|---|---|---|---|
| 1 | `PopoverMenuItem` | `apps/packages/ui/src/primitives/PopoverMenuItem.tsx:20` | `PopoverMenuItem` | **33 files** — dominant |
| 2 | `DropdownMenuItem` (radix-backed kit) | `apps/packages/ui/src/kit/DropdownMenu.tsx:82` | `DropdownMenuItem` | 4 files |
| 3 | `PaneOptionsMenuItem` | `apps/packages/ui/src/layout/PaneOptionsMenuItem.tsx:12` | `PaneOptionsMenuItem` | 3 files |
| 4 | `ContextMenuItem` (radix-backed kit) | `apps/packages/ui/src/kit/ContextMenu.tsx:57` | `ContextMenuItem` | **0 — the entire `ContextMenu.tsx` file is unused, zero importers anywhere** |
| 5 | `RunLocationMenuItem` (thin wrapper over #1) | `apps/packages/product-client/src/components/automations/controls/run-location/AutomationRunLocationMenu.tsx:201` | `RunLocationMenuItem` | 1 (same-file `RunLocationRows`) |

**How they differ:**
- `PopoverMenuItem` (button-rooted, own click handling, `stopPropagation` built in, `variant: default|sidebar`, `density: default|compact`, optional multi-line description via `children`) is the de facto standard — 33 adopters.
- `DropdownMenuItem`/`ContextMenuItem` are Radix-primitive wrappers (`data-slot`, `data-highlighted`, keyboard nav free from Radix) — a genuinely different technical approach (real menu semantics/roving-focus vs. `PopoverMenuItem`'s plain-button-in-a-popover). `DropdownMenuItem` earns its place (4 real menus: `WorkspaceItemMenu`, `ProposedPlanCard`, `RightPanelNewTabMenu`, `WorkspaceActionsMenu` — genuine native-menu-semantics use cases with shortcuts/separators). `ContextMenuItem` has **zero** adopters — the whole `kit/ContextMenu.tsx` (Radix context-menu wrapper, checkbox/radio items, submenus) is dead weight, superseded by whatever native/DropdownMenu-based approach right-click menus actually use in this codebase.
- `PaneOptionsMenuItem` (Button-rooted, `reserveIconSlot`, simpler single-line) duplicates ~70% of `PopoverMenuItem`'s visual recipe (`min-h-7`/`min-h-8`, `rounded-lg`, `hover:bg-list-hover`) with a smaller API and only 3 adopters (`ScratchPadPanel`, `FileViewerFrame`, `GitReviewOptionsMenu`) — all three could pass `density="compact"` to `PopoverMenuItem` instead.
- `RunLocationMenuItem` is a valid thin domain wrapper over `PopoverMenuItem` (adds a `detail` sub-span) — fine, not true duplication.

**Closest to canonical:** `PopoverMenuItem` — most complete API, 33 real adopters, already-audited hover/opacity-vs-color-token comment trail (i.e. has had real design review), new token vocabulary throughout.

**Consolidation recommendation:** delete `kit/ContextMenu.tsx` entirely (0 usages) unless something imminent needs real right-click semantics — right now it's unsanctioned dead surface. Fold `PaneOptionsMenuItem`'s 3 call sites onto `PopoverMenuItem` (density="compact") and delete `PaneOptionsMenuItem.tsx`. Keep `DropdownMenuItem` — it's genuinely different (Radix roving focus + keyboard) and has real multi-file adoption for that reason.

---

## FAMILY 5 — Empty state ("no X yet" block)

| # | Member | Package:file:line | Export | Adoption |
|---|---|---|---|---|
| 1 | `EmptyState` (ui, generic) | `apps/packages/ui/src/layout/EmptyState.tsx:10` | `EmptyState` | 5 files (`WorkflowDefinitionList`, `CloudWorkspaceList`, `WorkspaceInventory`, `AutomationSurface`, `CoworkArtifactsPanel`, `WorkflowDefinitionsAccessScreen` — 6 actually) |
| 2 | `SettingsEmptyState` (product-ui, settings-flavored) | `apps/packages/product-ui/src/settings/SettingsEmptyState.tsx:19` | `SettingsEmptyState` | **21 files** — dominant in settings |
| 3 | `GitReviewEmptyState` (git-review-flavored) | `apps/packages/product-client/src/components/workspace/git/GitReviewEmptyState.tsx:9` | `GitReviewEmptyState` + `GitReviewEmptyStateAction` | 1 direct + re-wrapped by `GitReviewInlineEmptyState`/`DiffDisplayPolicyPlaceholder` (`GitReviewInlineState.tsx`), used throughout `GitReviewFileRow.tsx` |
| 4 | `SecretList`'s inline empty block | `apps/packages/product-ui/src/secrets/SecretList.tsx:34` | not exported, inline JSX | 1 (itself) |
| 5 | Inline `"No chats yet"`/`"No repositories yet"` text-only rows | multiple: `CoworkThreadsSection.tsx:161`, `WorkspaceStatusPlayground.tsx:390`, `AutomationRunsList.tsx:31` | inline `<div>` | 1 each |

**How they differ:**
- `EmptyState` (ui/layout): bordered box (`rounded-lg border border-dashed border-border`), `min-h-40`, centered, `<h3>` title.
- `SettingsEmptyState`: no border/box at all ("flat" per its own doc comment — deliberately the "retirement of the card box" pattern), `size: compact|full`, icon slot capped `text-title`, description capped `48ch`.
- `GitReviewEmptyState`: no border/box either, `variant: panel|inline`, icon rendered *inline beside* the title text (not stacked above it like the other two) — a real visual delta, not just styling.
- `SecretList`'s inline block: bordered (`rounded-md border-dashed border-border-light` — yet a *third* border-radius/color pairing distinct from `EmptyState`'s `rounded-lg border-border`), icon-above-title-above-description-above-action — same shape as `EmptyState` but hand-rolled instead of reusing it.
- The bare-text rows (`"No chats yet"`, `"No repositories yet"`, `"No runs queued yet."`) skip the empty-state component family entirely — just a muted `<div>` with a `py-*`/`px-*` pad. Fine for tiny inline slots (sidebar sub-lists), but three near-identical one-liners exist independently (`CoworkThreadsSection`, `AutomationRunsList`, and `RepoScopeStates`' loading/empty text before it upgrades to `SettingsEmptyState`).

**Closest to canonical:** `SettingsEmptyState` is the most-adopted and most deliberately designed (explicit doc comment about being the "flat" retirement of a card pattern, `compact|full` size variants covering both inline-gate and full-page use). `EmptyState` (ui/layout) is the generic non-settings fallback and is fine to keep as the non-settings default.

**Consolidation recommendation:**
- Fold `SecretList`'s inline hand-rolled empty block into `EmptyState` (ui/layout) — same exact shape, just re-implemented with slightly different border tokens. This is genuine unsanctioned drift: `rounded-md`/`border-border-light` vs. the canonical `rounded-lg`/`border-border`.
- Keep `GitReviewEmptyState` separate — its icon-inline-with-title layout and `panel|inline` sizing are a real visual delta serving a cramped review-pane context, not accidental duplication.
- Keep `EmptyState` vs `SettingsEmptyState` as two canonical forms (bordered generic vs. flat settings) — both are already the target of wide adoption in their respective domains; don't merge them, the border-vs-flat split is an intentional design decision documented in `SettingsEmptyState`'s comment.
- The three independent one-line "No X yet" text rows are low-risk (trivial markup) — not worth a shared component, but flag if a fourth one is about to be added: reach for `SettingsEmptyState size="compact"` instead at that point.

---

## FAMILY 6 — Section header / group header (sidebar + menu + settings)

| # | Member | Package:file:line | Export | Adoption |
|---|---|---|---|---|
| 1 | `SectionHeader` (ui/layout, generic) | `apps/packages/ui/src/layout/SectionHeader.tsx:10` | `SectionHeader` | **0 — dead code, zero usages anywhere in the repo** |
| 2 | `ProductSidebarSectionHeader` | `apps/packages/product-ui/src/sidebar/ProductSidebarLayout.tsx:66` | `ProductSidebarSectionHeader` | 6 files (real sidebar section header — Threads/Repositories/Cleanup) |
| 3 | `SettingsSection` (title/description/action + eyebrow) | `apps/packages/product-ui/src/settings/SettingsSection.tsx:20` | `SettingsSection` | many (settings panes) |
| 4 | `SettingsEyebrow` (the label primitive `SettingsSection` is built on) | `apps/packages/product-ui/src/settings/SettingsEyebrow.tsx:20` | `SettingsEyebrow` | 6 files directly + every `SettingsSection` consumer indirectly |
| 5 | `RunLocationSectionHeader` (automations menu group label) | `apps/packages/product-client/src/components/automations/controls/run-location/AutomationRunLocationMenu.tsx:28` | `RunLocationSectionHeader` | 2 (same-file `AutomationRunLocationSelector`) |
| 6 | `SettingsMenu`'s inline group-label `<div>` | `apps/packages/ui/src/primitives/SettingsMenu.tsx:62` | not exported, inline | 1 |

**How they differ:** `#1 SectionHeader` (ui/layout) is a fully generic title+description+actions header with an `<h2 className="text-heading font-semibold">` — never imported by anything; it looks superseded by `SettingsSection`+`SettingsEyebrow` (mono-uppercase eyebrow style) for settings, and by `ProductSidebarSectionHeader` (hover-reveal actions, `text-sidebar-row`) for sidebar. `#5` and `#6` are two more independently-hand-rolled "muted label row above a group of menu items" patterns — `RunLocationSectionHeader` is a one-line `<div className="flex min-h-6 items-center truncate px-2 py-1 text-ui text-muted-foreground">`, `SettingsMenu`'s inline version is `<div className="min-h-6 truncate px-2 py-1 text-ui-sm text-foreground-tertiary">` — nearly the same className, different text-size token (`text-ui` vs `text-ui-sm`) and different muted-color token (`text-muted-foreground` vs `text-foreground-tertiary`), for the same visual job (a menu group label).

**Closest to canonical:** `ProductSidebarSectionHeader` for sidebar sections (hover-reveal actions is real UX, already the sanctioned pattern); `SettingsEyebrow`/`SettingsSection` for settings sections (mono-uppercase, already dominant). Neither needs the dead generic `SectionHeader`.

**Consolidation recommendation:**
- Delete `ui/src/layout/SectionHeader.tsx` — 0 usages, fully superseded by the two domain-specific header patterns above.
- Unify `RunLocationSectionHeader` and `SettingsMenu`'s inline group-label div into one shared "popover menu group label" component (they're one Tailwind-class disagreement apart: `text-ui`/`text-muted-foreground` vs `text-ui-sm`/`text-foreground-tertiary`) — small win, but it's the third independent "muted label above a group of rows" implementation after the two settings/sidebar ones already converged.

---

## FAMILY 7 — Table (dense grid rows)

| # | Member | Package:file:line | Export | Adoption |
|---|---|---|---|---|
| 1 | `kit/Table` (shadcn-style `<table>` wrapper family) | `apps/packages/ui/src/kit/Table.tsx:5` | `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell`, `TableFooter`, `TableCaption` | **0 — dead, zero importers anywhere** |
| 2 | `ModelTable` (raw `<table>`, hand-rolled) | `apps/packages/product-ui/src/settings/ModelTable.tsx:131` | `ModelTable` | 1 (`HarnessAllModelsSection`) |
| 3 | Inline `<table>` in `OrganizationModelPolicyPane` (conflicts table) | `apps/packages/product-client/src/components/settings/panes/OrganizationModelPolicyPane.tsx:199` | not exported, inline | 1 (itself) |

**How they differ:** `kit/Table` is a full shadcn-parity primitive set (`data-slot` attrs, `hover:bg-hover`, `data-[state=selected]:bg-selected`) that nothing uses. `ModelTable` and the inline conflicts table in `OrganizationModelPolicyPane` both hand-roll raw `<table>`/`<thead>`/`<tbody>` markup with their own local `TH_CLASS`/`TD_CLASS` constants (or inline `className`s) instead of reaching for `kit/Table` — two independent re-implementations of exactly the primitive that already exists unused in `kit/`.

**Closest to canonical:** `kit/Table` has the most complete API (caption, footer, selected-row state slot) but zero real-world exercise. `ModelTable` is the more production-hardened one (overflow handling, sparse-cell `Dash()` placeholder, effort/mode chip cells, `Switch` toggle column) but rebuilds table chrome that `kit/Table` already offers.

**Consolidation recommendation:** rebuild `ModelTable` and the `OrganizationModelPolicyPane` conflicts table on top of `kit/Table`'s primitives (they'd inherit `hover:bg-hover`/`data-[state=selected]:bg-selected` for free) — or, if `kit/Table`'s shadcn recipe doesn't fit the design language actually shipping, delete `kit/Table.tsx` as unsanctioned/unused and let `ModelTable`'s hand-rolled `TH_CLASS`/`TD_CLASS` become the one blessed table pattern (still worth sharing those two class constants out of `ModelTable.tsx` so the `OrganizationModelPolicyPane` table doesn't reinvent its own `border-b border-border-light`/`px-3.5 py-2.5` cell padding a third time).

---

## FAMILY 8 — File-tree row

| # | Member | Package:file:line | Export | Adoption |
|---|---|---|---|---|
| 1 | `FileTreeRow` | `apps/packages/product-client/src/components/workspace/files/tree/FileTreeRow.tsx:20` | `FileTreeRow` | 1 (`FileTreeDirectory`, both the `level===0` virtualized path and the `level>0` plain-recursion path) |

**Singleton — fine as-is.** Only one implementation of the file-tree row anatomy (chevron + entry icon + name + changed-marker). The directory component (`FileTreeDirectory.tsx`) does have two *rendering strategies* (virtualized root level via `@tanstack/react-virtual`, plain recursive `<div role="group">` for nested levels) but both funnel through this single row component — not a duplication, a legitimate virtualize-only-the-flat-root optimization.

---

## FAMILY 9 — Virtualized list wrapper (transcript rows)

| # | Member | Package:file:line | Export | Adoption |
|---|---|---|---|---|
| 1 | `VirtualTranscriptRowList` (mode-switching wrapper) | `apps/packages/product-ui/src/chat/transcript/VirtualTranscriptRowList.tsx:17` | `VirtualTranscriptRowList` | 1 (`ChatTranscriptRows`) |
| 2 | `VirtualizedTranscriptRowList` (`@tanstack/react-virtual`-backed) | `apps/packages/product-ui/src/chat/transcript/VirtualizedTranscriptRowList.tsx:43` | `VirtualizedTranscriptRowList` | 1 (used by #1) |
| 3 | `FullTranscriptRowList` (non-virtualized fallback, renders every row) | `apps/packages/product-ui/src/chat/transcript/FullTranscriptRowList.tsx:43` | `FullTranscriptRowList` | 1 (used by #1) |
| 4 | `FileTreeDirectory`'s inline `VirtualizedTree` | `apps/packages/product-client/src/components/workspace/files/tree/FileTreeDirectory.tsx:105` | not exported, inline | 1 (itself) |

**Not a duplication family — this is a deliberate two-tier strategy pattern**, well-documented in-code (`VirtualTranscriptRowList`'s comment explains the per-session mode latch to avoid mid-session DOM remounts). `#2`/`#3` share the exact same scroll-anchor/history-prefetch/stick-to-bottom logic (both call `useTranscriptStickToBottom`, both replicate the *same* `logPrefetchDecision`/`maybeLoadOlderHistory` callback bodies nearly verbatim — this is the one real "should this be extracted" flag inside an otherwise-intentional pattern: the prefetch/anchor logic in `VirtualizedTranscriptRowList.tsx` lines 135–204 and `FullTranscriptRowList.tsx` lines 97–160 are ~90% identical and could share a `useOlderHistoryPrefetch` hook). `#4` (`FileTreeDirectory`'s inline `@tanstack/react-virtual` usage) is independent from the transcript virtualizer and does not share any code with it — reasonable, since file-tree virtualization needs are much simpler (fixed 28px row estimate, no stick-to-bottom/prefetch).

**Consolidation recommendation:** keep both transcript wrappers (virtualized + full) — genuinely different rendering strategies with a real fallback reason (`onFallback`). Extract the duplicated `logPrefetchDecision`/`maybeLoadOlderHistory` older-history-prefetch logic (near-identical in both `VirtualizedTranscriptRowList.tsx` and `FullTranscriptRowList.tsx`) into one shared hook.

---

## SINGLETONS (fine as-is, listed for coverage)

- `FileTreeRow` — single file-tree row implementation, virtualized-root + plain-recursive-nested both funnel through it. (`apps/packages/product-client/src/components/workspace/files/tree/FileTreeRow.tsx`)
- `GitReviewFileRow` — single git-review file-row (diff header + expand/collapse + hunk actions); no competing implementation. (`apps/packages/product-client/src/components/workspace/git/GitReviewFileRow.tsx`)
- `TurnDiffFileRow` — single chat-transcript inline-diff file row; visually distinct domain (chat bubble, not sidebar/review-pane) from `GitReviewFileRow`, correctly not unified with it. (`apps/packages/product-client/src/components/workspace/chat/transcript/TurnDiffFileRow.tsx`)
- `ModelConfigGrid` — single org agent-policy grid (distinct from `ModelTable`'s "All Models" catalog table per its own doc comment — not a duplicate, a different data shape/purpose). (`apps/packages/product-ui/src/settings/ModelConfigGrid.tsx`)
- `PickerEmptyRow` — single "empty search-picker" text row, 4 real adopters (`EnvironmentSearchSelect`, `HomeProjectMenu`, `HomeTargetPicker`, `AutomationAgentRunConfigPicker`) via `PickerPopoverContent`. (`apps/packages/ui/src/primitives/PickerPopoverContent.tsx`)
- `PopoverSearchField` — single search-input-in-a-popover row, used by `PickerPopoverContent` and the picker family. (`apps/packages/ui/src/primitives/PopoverSearchField.tsx`)
- `SettingsRow` — single flat settings row (label/description + right-aligned control), 18 real adopters, no competing implementation found. (`apps/packages/product-ui/src/settings/SettingsRow.tsx`)
- `RowActionIconButton`/`RowActionIndicator` — single reveal-on-hover row-trailing-action pair, used consistently across `WorkspaceInventoryRow`, `AutomationInventoryList`, `AutomationRunsList`, `WorkspaceItemMenu`, `HomeOnboardingCards`, `PlanReferenceAttachmentCard`, `ProductSidebarActionButton`. (`apps/packages/ui/src/layout/RowActionIconButton.tsx`)
- `CollapsibleSummaryRow` — defined, **zero usages anywhere** (not even in tests). Flag as dead alongside `SelectionRow`. (`apps/packages/ui/src/primitives/CollapsibleSummaryRow.tsx`)
- `ShortcutBadge` — single trailing-shortcut-chip primitive shared by `SidebarNavRow` and `ProductSidebarWorkspaceRow`/`ProductSidebarThreadRow`; no competing implementation. (`apps/packages/ui/src/layout/ShortcutBadge.tsx`)

---

## Summary of concrete actions (highest-value first)

1. **Delete dead code** (zero usages anywhere, confirmed by grep):
   - `apps/packages/ui/src/primitives/SelectionRow.tsx`
   - `apps/packages/ui/src/primitives/CollapsibleSummaryRow.tsx`
   - `apps/packages/ui/src/layout/SidebarNavItem.tsx`
   - `apps/packages/ui/src/layout/SectionHeader.tsx`
   - `apps/packages/ui/src/kit/Table.tsx` (or wire `ModelTable`/`OrganizationModelPolicyPane` onto it instead — pick one)
   - `apps/packages/ui/src/kit/ContextMenu.tsx` (whole file, incl. `ContextMenuItem`)
   - `apps/packages/product-ui/src/account/ConnectedProviderRow.tsx` (0 usages outside its own file — confirm truly orphaned before deleting)
2. **Extract shared roster-row primitive** — `SubagentRosterRow`/`TerminalRosterRow` are ~90% duplicate code (Family 3).
3. **Unify the three `MetadataCell` copies** across `WorkspaceInventoryRow.tsx`, `AutomationInventoryList.tsx`, `AutomationRunsList.tsx` (Family 1).
4. **Fold `AutomationInventoryRow`'s hand-rolled popover menu** into `PopoverButton`+`PopoverMenuItem`/`DropdownMenu` (Family 1).
5. **Fold `PaneOptionsMenuItem`'s 3 call sites** onto `PopoverMenuItem` with `density="compact"`, then delete `PaneOptionsMenuItem.tsx` (Family 4).
6. **Fold `SecretList`'s inline hand-rolled empty block** onto the canonical `EmptyState` (Family 5).
7. **Unify `RunLocationSectionHeader` and `SettingsMenu`'s inline group-label div** into one shared menu-group-label component (Family 6).
8. **Extract the duplicated older-history-prefetch logic** shared between `VirtualizedTranscriptRowList.tsx` and `FullTranscriptRowList.tsx` into one hook (Family 9).
