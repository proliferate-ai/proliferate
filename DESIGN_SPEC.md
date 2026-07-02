# DESIGN SPEC — Header + Popover Polish (`ux/header-popovers-polish`)

All paths relative to `/Users/pablohansen/proliferate-ux-header-popovers`.
Owner's brief: popovers "more like codex but in our style"; header cleaned up; tabs get a NEW look; "+" / selector buttons return to the PRE-migration chip feel (git `79520c8df`).

Ground rules honored throughout: font sizes/line-heights only via semantic tokens (`text-ui` 13/18, `text-ui-sm` 12/16, `text-xs/sm/base/chat/lg/xl`, …) — no `text-[Npx]` / `leading-[Npx]` / rem arbitraries; tailwind-merge only via `@proliferate/ui/utils/tw-merge`; shared primitives change, never per-callsite forks; no `@/lib/access` imports in components; deprecated code deleted, not commented out.

---

## 0. The design in one paragraph

Our `POPOVER_FRAME_CLASS` is already the codex surface (90 %-alpha popover fill, 8 px blur, 0.5 px hairline ring, 12 px radius, hairline-spread shadow, 4 px padding). The work is **convergence, not invention**: every menu surface in the app (kit DropdownMenu/ContextMenu/Popover, command palette, nine hand-rolled one-offs) adopts that one frame; every menu row adopts one item recipe (28 px row, `text-ui`, `rounded-lg`, `px-2.5 py-[5px]`, `bg-list-hover` hover, 14 px icons at 75 %→100 % opacity); shortcuts become plain muted `text-ui-sm` text; separators become inset hairlines; all Radix surfaces get one shared 150 ms enter animation. In the header, the action buttons get their pre-migration 1 px `--color-border` rim back (one token), and tabs get a new hybrid look: flat codex pills at rest (10 px radius, 12 px text) that "chip up" with a fill + hairline rim when active — so rest state reads codex-flat and engaged state rhymes with the restored chip buttons.

---

## 1. Canonical popover surface (Bucket A)

### 1.1 New leaf module `apps/packages/ui/src/primitives/popover-surface.ts` (NEW FILE)

Move the two constants out of `PopoverButton.tsx` into a dependency-free leaf so `kit/*` can import them without an import cycle (`PopoverButton` imports `kit/Popover`):

```ts
export const POPOVER_FRAME_CLASS =
  "m-px rounded-xl bg-popover/90 text-popover-foreground shadow-popover ring-[0.5px] ring-popover-ring backdrop-blur-sm";
export const POPOVER_SURFACE_CLASS = `${POPOVER_FRAME_CLASS} flex max-h-[calc(100vh-1rem)] min-w-[240px] max-w-[320px] select-none flex-col overflow-y-auto p-1`;
```

Class strings are **unchanged** — they are already the codex recipe. Codex→ours mapping, for the record:

| Codex | Ours |
|---|---|
| `bg-token-dropdown-background/90` (rgba(45,45,45,.90) dark) | `bg-popover/90` (`--color-popover` per theme, desktop.css:133 etc.) |
| `backdrop-blur-sm` (8px) | `backdrop-blur-sm` (8px) |
| `ring-[0.5px]` ring-token-border (~8 % white) | `ring-[0.5px] ring-popover-ring` (`--color-popover-ring`, 8–9 % per theme) |
| `rounded-xl` (12px) | `rounded-xl` (12px) |
| `.shadow-xl-spread` = `0 0 0 .5px border, 0 8px 16px -4px #0000001f` | `shadow-popover` = `0 0 0 0.5px var(--color-popover-ring), 0 8px 16px -4px rgb(0 0 0 / 0.12)` (desktop.css:62) — identical |
| `px-1 py-1` + `m-px` | `p-1` + `m-px` |
| `min-w-[260px]` | `min-w-[240px]` (keep ours; widths set per callsite) |

No new design vars are needed for the surface — every value already exists as a token.

**`apps/packages/ui/src/primitives/PopoverButton.tsx`**:
- Delete the local constant definitions (lines 21–23); add
  `export { POPOVER_FRAME_CLASS, POPOVER_SURFACE_CLASS } from "./popover-surface";`
  so all ~30 existing `from "@proliferate/ui/primitives/PopoverButton"` imports keep working unchanged.
- Content wrapper (line 174) gains the shared enter animation:
  ```
  className={`z-50 outline-none animate-popover-in [transform-origin:var(--radix-popover-content-transform-origin)] ${className}`}
  ```

### 1.2 Enter animation (design package, NOT inline)

Codex animates menu entry (keyframes unpublished; motion tokens `.15s` + `cubic-bezier(.19,1,.22,1)`). **Decision:** one shared 150 ms fade+scale-in, no exit animation (Radix unmounts immediately; exit would need `forceMount` churn for zero payoff).

`apps/packages/design/src/css/desktop.css`:
- In the `@theme` animations block (next to `--animate-pulse-dot`, ~line 89):
  ```css
  --animate-popover-in: popover-in 150ms cubic-bezier(0.19, 1, 0.22, 1); /* codex --cubic-enter */
  ```
- With the other keyframes (near `@keyframes panel-in`, ~line 1666):
  ```css
  @keyframes popover-in {
    from { opacity: 0; transform: scale(0.98); }
    to { opacity: 1; transform: scale(1); }
  }
  ```

Applied at the **positioned wrapper** (PopoverButton content, kit Dropdown/Context content, Tooltip) — not inside `POPOVER_SURFACE_CLASS` — so hand-positioned surfaces (ChatTabsMenu, OpenTargetMenu, ManualChatGroupEditorPopover) don't double-animate; they keep their existing behavior.

### 1.3 kit/DropdownMenu.tsx — adopt the frame + item recipe

Import `POPOVER_FRAME_CLASS` from `../primitives/popover-surface`.

- `DropdownMenuContent` (line 64) and `DropdownMenuSubContent` (line 252) — replace
  `"z-50 min-w-[220px] overflow-hidden rounded-xl border border-border bg-popover p-1 text-foreground shadow-md"` with:
  ```
  `z-50 min-w-[220px] overflow-hidden p-1 ${POPOVER_FRAME_CLASS} animate-popover-in [transform-origin:var(--radix-dropdown-menu-content-transform-origin)]`
  ```
  (Kills the divergent grammar: opaque bg → 90 % + blur, 1 px border → 0.5 px ring, shadow-md → shadow-popover, text-foreground → text-popover-foreground via frame.)

- `DropdownMenuItem` (line 96):
  ```
  "relative flex min-h-7 cursor-pointer select-none items-center gap-1.5 rounded-lg px-2.5 py-[5px] text-ui outline-none data-[highlighted]:bg-list-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[variant=destructive]:text-destructive data-[inset]:pl-8"
  ```
  Deltas: `rounded-md`→`rounded-lg`, `px-2 py-1.5`→`px-2.5 py-[5px]` + `min-h-7` (28 px codex row), `gap-2`→`gap-1.5` (6 px codex), drop `leading-5` (`text-ui` carries 18 px LH — leading-5 was fighting the token), `bg-accent`→`bg-list-hover`.

- `DropdownMenuCheckboxItem` (line 114) / `DropdownMenuRadioItem` (line 150):
  ```
  "relative flex min-h-7 cursor-pointer select-none items-center gap-1.5 rounded-lg py-[5px] pl-8 pr-2.5 text-ui outline-none data-[highlighted]:bg-list-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
  ```
  Indicator span: `absolute left-2` → `absolute left-2.5` (align with the 10 px row inset).

- `DropdownMenuLabel` (line 177): replace the mono-uppercase treatment with a quiet codex-adjacent label (codex has no section headers at all; when we need one it must whisper):
  ```
  "px-2.5 pb-1 pt-1.5 text-ui-sm font-medium text-muted-foreground data-[inset]:pl-8"
  ```

- `DropdownMenuSeparator` (line 192): full-bleed → inset hairline (codex insets by row padding-x):
  ```
  "mx-2.5 my-1 h-px bg-border"
  ```

- `DropdownMenuShortcut` (line 206): plain muted text, no chip, no tracking (codex `text-xs text-token-description-foreground`):
  ```
  "ml-auto pl-2 text-ui-sm text-muted-foreground"
  ```

- `DropdownMenuSubTrigger` (line 233):
  ```
  "relative flex min-h-7 cursor-pointer select-none items-center gap-1.5 rounded-lg px-2.5 py-[5px] text-ui outline-none data-[highlighted]:bg-list-hover data-[state=open]:bg-list-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[inset]:pl-8"
  ```
  Chevron (line 239): `"ml-auto size-3.5 text-muted-foreground opacity-75"` (codex trailing chevron is muted, 75 % opacity).

### 1.4 kit/ContextMenu.tsx — mirror byte-for-byte

Zero consumers today, but it is an exported building block; keep it in lockstep, don't delete. Apply exactly the strings from §1.3 to the corresponding slots (`Content` :39, `SubContent` :227, items :71/:89/:125, sub-trigger :208, label, separator, shortcut) with the transform-origin var swapped to `--radix-context-menu-content-transform-origin`.

### 1.5 kit/Popover.tsx — default content

`PopoverContent` (line 31), replace `"z-50 w-72 rounded-xl border border-border bg-popover p-3 text-foreground shadow-md outline-none"` with:
```
`z-50 w-72 p-3 outline-none ${POPOVER_FRAME_CLASS}`
```
(Only affects direct kit consumers — PopoverButton renders `PopoverPrimitive.Content` itself.)

### 1.6 kit/Command.tsx + primitives/CommandPalette.tsx

`kit/Command.tsx`:
- `CommandInput` (line ~43): drop `leading-5`? (it has none) — change class to drop nothing but align type:
  `"flex h-11 w-full bg-transparent py-3 text-ui outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"` (remove `leading-5`).
- `CommandEmpty`: `"py-8 text-center text-ui text-muted-foreground"` (drop `leading-5`).
- `CommandGroup` heading utilities: `[&_[cmdk-group-heading]]:px-2.5 … [&_[cmdk-group-heading]]:text-ui-sm [&_[cmdk-group-heading]]:font-medium … [&_[cmdk-group-heading]]:text-muted-foreground` (was `px-2`/`text-ui`/`leading-5`/`text-foreground` — group headers go quiet, rows carry the ink).
- `CommandSeparator`: `"mx-2.5 my-1 h-px bg-border"` (was `-mx-1 my-1`).
- `CommandItem` (line ~118):
  ```
  "group relative flex min-h-7 cursor-pointer select-none items-center gap-2 rounded-lg px-2.5 py-[5px] text-ui outline-none data-[selected=true]:bg-list-hover data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50"
  ```
- `CommandShortcut`: `"ml-auto pl-2 text-ui-sm text-muted-foreground"`.

`primitives/CommandPalette.tsx`:
- Panel (line 141): join the hairline-ring family but keep the elevated shadow + heavier blur (topmost surface over chat text — **decision**):
  ```
  "fixed left-1/2 top-[20vh] flex max-h-[calc(100vh-1rem)] w-[calc(100vw-16px)] max-w-[580px] -translate-x-1/2 flex-col overflow-hidden rounded-2xl bg-popover/90 text-popover-foreground shadow-floating-dark ring-[0.5px] ring-popover-ring backdrop-blur-[16px]"
  ```
  (border border-border/70 → ring; `/85`→`/90`; `text-foreground`→`text-popover-foreground`.)
- `CommandPaletteInput` (line ~167): `"h-11 w-full min-w-0 bg-transparent text-ui text-foreground outline-none placeholder:text-muted-foreground"` — deletes the `text-base leading-[21px]` pair (`leading-[21px]` is an arbitrary-leading violation; `text-base` is 11 px, wrong scale for the primary input).
- `CommandPaletteGroup` headings: `text-base` → `text-ui-sm`.
- `CommandPaletteItem` (line ~211):
  ```
  "flex h-9 cursor-default select-none items-center gap-2 rounded-lg px-2.5 text-ui text-foreground outline-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-45 data-[selected=true]:bg-list-hover"
  ```
  (`text-xs leading-4` → `text-ui`; `rounded-md px-2` → family metrics; `bg-accent`/`text-accent-foreground` → `bg-list-hover`, drop the selected text class — base is already `text-foreground`. Keep `h-9`: palette rows intentionally taller than menu rows.)

### 1.7 kit/Tooltip.tsx — same chrome family

Line 43: replace `border border-border/60 … shadow-floating backdrop-blur-lg` with the hairline family, keep tooltip-specific opacity/radius/padding:
```
"rounded-lg bg-popover/96 px-2.5 py-1 … shadow-popover ring-[0.5px] ring-popover-ring backdrop-blur-sm"
```
(Keep every other class in that string as-is.)

### 1.8 PopoverSearchField / PickerPopoverContent

- `primitives/PopoverSearchField.tsx` line 26: magnifier `size-4` → `size-3.5` (codex uses icon-2xs 14 px for the search glyph). Everything else already matches the codex flat-row recipe — no other change.
- `primitives/PickerPopoverContent.tsx`: no change (max-h-80 body, `px-2.5 py-[5px]` empty row already on-recipe).

---

## 2. Item row recipe (summary table)

One rhythm everywhere — 28 px rows, `text-ui` (13/18), 10 px horizontal inset, 8 px item radius (concentric: 12 px surface − 4 px padding = 8 px — **decision:** keep `rounded-lg` 8 px over codex's 10 px, our geometry is cleaner), `bg-list-hover` hover fill, 14 px icons at 75 %→100 % opacity, trailing hints `text-ui-sm text-muted-foreground`:

| Slot | Class (exact) |
|---|---|
| PopoverMenuItem (default) | unchanged: `group/menu-item flex min-h-7 w-full cursor-pointer select-none flex-col rounded-lg px-2.5 py-[5px] text-ui font-normal text-popover-foreground outline-none transition-colors …` + `hover:bg-list-hover focus:bg-list-hover` |
| PopoverMenuItem default **icon** slot | change to the compact treatment (line 50): `flex size-3.5 shrink-0 items-center justify-center text-muted-foreground opacity-75 transition-opacity group-hover/menu-item:opacity-100 group-focus/menu-item:opacity-100` |
| DropdownMenuItem / ContextMenuItem | §1.3 string |
| CommandItem | §1.6 string |
| Separators (kit + Command) | `mx-2.5 my-1 h-px bg-border` |
| Shortcuts (all) | `ml-auto pl-2 text-ui-sm text-muted-foreground` |
| Section labels | `px-2.5 pb-1 pt-1.5 text-ui-sm font-medium text-muted-foreground` |

`apps/packages/ui/src/primitives/PopoverMenuItem.tsx`: only the default-density `defaultIconClassName` changes (line 50) — API, densities, variants, trailing (already `[&_*]:text-ui-sm`) all stay.

`apps/desktop/src/components/workspace/shell/tabs/TabContextMenu.tsx` (line ~28): separators `"my-1 border-t border-border"` → `"mx-2.5 my-1 h-px bg-border"` (matches the kit separator; 10 px inset aligns with row text).

---

## 3. Header redesign (Bucket B)

### 3.1 Token block — `apps/packages/design/src/css/desktop.css` (`:root` at ~line 2172)

| Var | New value | Was | Why |
|---|---|---|---|
| `--workspace-shell-header-height` | `46px` (keep) | 46px | **Decision:** stay codex `--height-toolbar`; right-panel `--tab-system-height` is pegged to 46px — reverting to the pre-migration 48px would ripple. |
| `--workspace-shell-tab-font-size` | `var(--text-ui-sm)` | `var(--text-sm)` | Codex tabs are 12 px `text-sm`; our `text-ui-sm` = 12 px at default preset (text-sm is 10 px). |
| `--workspace-shell-tab-line-height` | `var(--text-ui-sm--line-height)` | `var(--text-sm--line-height)` | rides the same token |
| `--workspace-shell-tab-radius` | `0.625rem; /* 10px — codex rounded-lg */` | `0.5rem` | pre-migration AND codex tab radius; re-establishes tab 10 px vs button 8 px hierarchy |
| `--workspace-shell-tab-active-border` | `var(--color-border-heavy)` | `transparent` | NEW look: active tab "chips up" (see 3.2) |
| `--workspace-shell-tab-selected-border` | `var(--color-border-heavy)` | `transparent` | multi-selected matches active rim |
| `--workspace-shell-action-border` | `var(--color-border)` | `transparent` | **THE pre-migration restore** — visible 1 px rim at rest on +, filter, Run, open-in split, panel toggle, workspace 3-dot |
| `--workspace-shell-action-font-size` | `var(--text-ui-sm)` | `var(--text-sm)` | harmonize with tabs (Run label and filter count read at 12 px like codex toolbar text) |
| `--workspace-shell-action-line-height` | `var(--text-ui-sm--line-height)` | `var(--text-sm--line-height)` | idem |

Unchanged (verify, don't touch): tab/action height `1.75rem`, weights `500`, tab icon `0.875rem`, action icon `0.8125rem`, action radius `0.5rem`, hover bg `var(--color-composer-control-hover)` + hover fg `var(--color-foreground)`, tab hover bg `var(--color-accent)`, tab active/selected fills 8 %/10 % foreground mixes, inactive/hover borders `transparent`. Update the two stale comments above the vars ("ghost (no rim…)" → describe the chip-at-rest recipe; "fill-only tabs, no rim" → describe flat-at-rest / rimmed-when-active).

The `.workspace-shell-*` rules themselves (2210–2311) are already border-aware (`border: 1px solid var(--workspace-shell-action-border)`, split-seam handling, hover/[data-state=open] fills) — **no rule changes**. `.glass-editor-panel-new-tab-menu-trigger` (2259) already forces right-panel triggers flat (`border-color: transparent; background-color: transparent`) — keep; that's the intended exception.

### 3.2 Tabs — the NEW look (`apps/desktop/src/components/workspace/shell/tabs/ChromeWorkspaceTab.tsx`)

Concept (**decision**): codex-flat at rest, chip when engaged. Inactive tabs are borderless quiet pills (muted 12 px text, transparent fill); hover paints the accent tint; the **active** tab gets the 8 % foreground fill **plus** a `--color-border-heavy` hairline rim so it reads as the same "chip" species as the restored action buttons. This is genuinely new (current = fill-only, pre-migration = rims-everywhere) and makes the whole 46 px bar one visual system.

Component edits:
1. Surface span (line 77) — restore the border + transition that the migration dropped:
   ```
   "workspace-shell-tab__surface pointer-events-none absolute inset-0 rounded-[var(--workspace-shell-tab-radius,0.625rem)] border transition-[background-color,border-color] duration-150"
   ```
   (border-width 1px + colors from the vars; rest states resolve to `transparent` so nothing paints until active/selected.)
2. Content div (line 80): update the radius fallback to match: `rounded-[var(--workspace-shell-tab-radius,0.625rem)]` (keep the rest).
3. Label button (line 118): delete `text-sm leading-4` from the className — `.workspace-shell-tab__button` CSS owns tab type via the vars; the utility pair was dead weight fighting it. Resulting base:
   `"workspace-shell-tab__button relative z-10 h-full min-w-0 flex-1 justify-start rounded-none bg-transparent p-0 hover:bg-transparent"` + existing conditional `font-medium text-foreground` / `font-medium text-muted-foreground group-hover/tab:text-foreground` + gap classes (all unchanged — muted→foreground on hover is already codex's secondary→primary move).
4. Close buttons (lines 100, 163): unchanged — hover-only reveal, `size-4 rounded-md hover:bg-accent` is already codex behavior.

`HeaderTabs.tsx`: no changes (strip wrapper, `h-7`, group underline `h-0.5 rounded-full` with inline group color all stay — the colored underline is our signature, keep it).

### 3.3 Group pill (`apps/desktop/src/components/workspace/shell/tabs/TabGroupPill.tsx`)

Fix the pre-existing arbitrary-leading violation; keep dimensions and `px-1` (pill width comes from layout math — don't change padding):
- manual (line 29): `"h-5 min-w-0 justify-center rounded-full border-0 px-1 py-0 text-sm font-semibold hover:opacity-90"`
- subagent (line 30): `"h-5 min-w-0 justify-center rounded-full border border-border/70 bg-foreground/5 px-1 py-0 text-sm font-medium text-muted-foreground hover:bg-foreground/8 hover:text-foreground"`

(Only delta: `leading-[13px]` deleted — `text-sm` brings its token line-height; the flex button centers it inside `h-5`.)

### 3.4 Title (`apps/desktop/src/components/workspace/shell/topbar/GlobalHeader.tsx` line 91)

```
"min-w-0 max-w-[220px] shrink-0 truncate px-1.5 text-ui font-medium text-foreground"
```
Deltas: `text-sm` (10 px) → `text-ui` (13 px — codex titles its window at `text-base` 14 px `electron:font-medium`; text-ui is our equivalent slot), drop `leading-5` (token LH). Root row `gap-1 px-2` stays.

### 3.5 Buttons — pre-migration feel restored (no component edits)

The markup for "+", filter, Run, SplitButton, panel toggle is byte-identical to `79520c8df`; the feel comes back entirely via `--workspace-shell-action-border: var(--color-border)` (§3.1). Verify after the token flip:
- `HeaderTabsActions.tsx` — "+" (`workspace-shell-icon-button`) and filter (`workspace-shell-action-button … px-1.5`): rim at rest, `composer-control-hover` fill + foreground text on hover/open. Unchanged file.
- `GlobalHeader.tsx` — Run (`workspace-shell-action-button font-medium`) and panel toggle (`workspace-shell-icon-button`): unchanged file (besides §3.4 title).
- `open-target/SplitButton.tsx` — unchanged; the split seam CSS (left segment `border-right-width: 0`, right segment 20 px) now renders the pre-migration single-divider chip. This is also the one button codex itself draws as a chip (`border-token-border bg-token-bg-fog`) — **decision:** no fog fill; exact pre-migration transparent fill, uniform across all header buttons rather than special-casing the split.
- `topbar/WorkspaceActionsMenu.tsx` line 79 — delete the `className="shadow-popover"` patch on `DropdownMenuContent` (the kit content now carries the full frame; the patch is redundant). Trigger keeps the shared chip classes — **decision:** the 3-dot after the title gets the rim too; one system, no per-callsite forks.

---

## 4. Callsite sweep — three disjoint buckets

### Bucket A — shared primitives + design vars (ship first; everything else inherits)
1. `apps/packages/design/src/css/desktop.css` — §1.2 animation token + keyframes **and** §3.1 workspace-shell token block (same file, two independent blocks; keep in one commit with Bucket A since B/C depend on it).
2. `apps/packages/ui/src/primitives/popover-surface.ts` — NEW (§1.1).
3. `apps/packages/ui/src/primitives/PopoverButton.tsx` — re-export consts; wrapper animation (§1.1).
4. `apps/packages/ui/src/primitives/PopoverMenuItem.tsx` — default icon slot (§2).
5. `apps/packages/ui/src/primitives/PopoverSearchField.tsx` — magnifier size-3.5 (§1.8).
6. `apps/packages/ui/src/primitives/CommandPalette.tsx` — panel/input/group/item (§1.6).
7. `apps/packages/ui/src/kit/DropdownMenu.tsx` — §1.3.
8. `apps/packages/ui/src/kit/ContextMenu.tsx` — §1.4.
9. `apps/packages/ui/src/kit/Popover.tsx` — §1.5.
10. `apps/packages/ui/src/kit/Command.tsx` — §1.6.
11. `apps/packages/ui/src/kit/Tooltip.tsx` — §1.7.

No changes needed (inherit automatically, verify visually): all `POPOVER_SURFACE_CLASS` consumers listed in the inventory — HeaderTabsActions, ChatTabWithMenu, TabGroupPillWithMenu, ChatTabsMenu, SidebarAccountFooter, HomeProjectMenu, HomeTargetPickerParts/HomeTargetPicker, SessionConfigControls, SessionModeControl, SessionReasoningEffortControl, WorkspaceMobilityLocationPopover, PaneOptionsMenu, FilePathContextMenuContent, WorkspaceItem, RepoGroup, GitReviewTargetSelector, GitReviewBaseSelector, AgentHarnessModelSelector, ChatDiffLineWrapContextMenu, AutomationRunLocationSelector, OrganizationSelectMenu, OrganizationMembersList, product-ui CloudChatHeader, SettingsMenu, EnvironmentSearchSelect; FRAME-only consumers ModelSelector, FileReferenceMenu, WorkspaceRenamePopover; kit DropdownMenu consumers RightPanelNewTabMenu + sidebar/WorkspaceItem (grep their `DropdownMenuContent`/`Item` for classNames that fight the new recipe — expected none besides WorkspaceActionsMenu's patch, Bucket B).

### Bucket B — header
1. `apps/desktop/src/components/workspace/shell/tabs/ChromeWorkspaceTab.tsx` — §3.2.
2. `apps/desktop/src/components/workspace/shell/tabs/TabGroupPill.tsx` — §3.3.
3. `apps/desktop/src/components/workspace/shell/topbar/GlobalHeader.tsx` — §3.4.
4. `apps/desktop/src/components/workspace/shell/topbar/WorkspaceActionsMenu.tsx` — remove `className="shadow-popover"` (§3.5).
5. `apps/desktop/src/components/workspace/shell/tabs/TabContextMenu.tsx` — separator string (§2).

Explicitly untouched: `HeaderTabsActions.tsx`, `SplitButton.tsx`, `HeaderTabs.tsx`, `WorkspaceTabStrip.tsx`, `HeaderTabsStripRows.tsx`, `HeaderGroupPillTab.tsx`, `workspace-chrome.ts` (46 px solid header + glass variant stay), `StandardWorkspaceShell.tsx`.

### Bucket C — one-off popover forks → converge on the frame
Each swaps its hand-rolled `rounded-* border border-* bg-popover* shadow-*` cluster for `POPOVER_FRAME_CLASS` (import from `@proliferate/ui/primitives/PopoverButton`), keeping local width/z/positioning/padding. Delete the replaced classes — no commented-out leftovers.

| File:line | New class |
|---|---|
| `apps/desktop/src/components/workspace/shell/tabs/SessionTitleRenamePopover.tsx:42` | `` `w-72 ${POPOVER_FRAME_CLASS} p-3` `` |
| `apps/desktop/src/components/.../ManualChatGroupEditorPopover.tsx:87` | `` `fixed z-[61] w-[304px] ${POPOVER_FRAME_CLASS} p-3` `` (keep manual flip logic) |
| `apps/desktop/src/components/.../DelegatedAgentHoverCard.tsx:204,233` | `` `fixed z-[70] … ${POPOVER_FRAME_CLASS} p-2.5` `` — chrome only; keep its text classes and positioning |
| `apps/desktop/src/components/.../RuntimePressureWorktreeTable.tsx:46,111` | `` `w-52 ${POPOVER_FRAME_CLASS} p-1` `` / `` `w-44 ${POPOVER_FRAME_CLASS} p-1` `` |
| `apps/desktop/src/components/.../TerminalHeaderIcon.tsx:195` | `` `w-56 ${POPOVER_FRAME_CLASS} p-1` `` (rounded-md → frame's rounded-xl) |
| `apps/desktop/src/components/.../CoworkThreadItem.tsx:72` | `` `w-44 ${POPOVER_FRAME_CLASS} p-1` `` |
| `apps/desktop/src/components/.../AutomationEditorControls.tsx:158,244` | `` `w-80 ${POPOVER_FRAME_CLASS} p-1` `` / `` `w-96 ${POPOVER_FRAME_CLASS} p-1` `` |
| `apps/desktop/src/components/.../SupportReportWindow.tsx:185` | `` `space-y-1 ${POPOVER_FRAME_CLASS} p-1` ``; also its item hover `bg-popover-accent` → `bg-list-hover` |

Left alone deliberately (**decisions**): `OpenTargetMenu.tsx` and `ChatTabsMenu.tsx` already compose `POPOVER_SURFACE_CLASS` with bespoke positioning/animation — chrome inherits, positioning refactors are out of scope. `FilePathContextMenuContent.tsx` submenu already uses SURFACE.

---

## 5. Decision log (owner said use judgment)

1. **Header stays 46 px** — codex toolbar parity; right-panel tab system and traffic-light inset are pegged to it. The pre-migration 48 px is not part of the "feel" the owner missed (the rim is).
2. **All header buttons get the rim**, including the 3-dot and filter; right-panel triggers stay flat via the existing override. One token, one system — codex's "chip only the split button" nuance loses to the explicit pre-migration ask.
3. **Tabs = flat pills at rest, chip when active** (fill + `border-heavy` hairline), radius 10 px vs button 8 px. New look that unifies with the restored chips; neither current fill-only nor pre-migration rims-everywhere.
4. **Tab + action type moves to `text-ui-sm` (12 px)** — codex toolbar/tab text is 12 px; our `--text-sm` (10 px) was below it and below the popover rows.
5. **Item inset stays `px-2.5`** (not codex's 8 px) — it's the established family metric across PopoverMenuItem/SearchField/EmptyRow; 2 px of delta isn't worth a sweep.
6. **Item radius stays `rounded-lg` 8 px** (not codex's 10 px) — concentric with the 12 px surface at 4 px padding.
7. **Hover token = `bg-list-hover` in every menu** (`bg-accent`, `bg-popover-accent` retired from menu rows) — same resolved color today, one semantic name forever.
8. **Shortcuts are plain muted `text-ui-sm` text** — no kbd chips, no `tracking-widest` (codex).
9. **Section labels lose the font-mono/uppercase costume** — codex groups with separators only; where we keep labels they go `text-ui-sm font-medium text-muted-foreground`.
10. **One 150 ms fade+scale enter animation, no exit** — applied at Radix wrappers only, defined as a design-package token (`--animate-popover-in`), never inline.
11. **Command palette keeps `rounded-2xl` + 16 px blur + `shadow-floating-dark`** but joins the 0.5 px ring family — it's the topmost surface and may sit one elevation above menus.
12. **`kit/ContextMenu` updated, not deleted** — zero consumers, but deletion is a separate cleanup; divergent duplicate strings are the actual bug.
13. **Codex's 5-row scroll cap + edge-fade masks: skipped** — our pickers cap with `max-h-80`; edge-fade keyframes would be net-new machinery with no owner ask.

---

## 6. Verification

1. `bash apps/desktop/scripts/check-design-system.sh` — must pass; this change *removes* two arbitrary-leading violations (`leading-[13px]`, `leading-[21px]`) and adds none.
2. Rebuild shared package dists (desktop consumes `@proliferate/ui` via `dist/` exports): `pnpm --filter @proliferate/ui build` (and `pnpm --filter @proliferate/product-ui build` if it re-exports affected primitives).
3. `pnpm --filter desktop typecheck` (or repo equivalent) for the import moves.
4. Visual pass in `pdev main`: (a) header at rest — chips on +/filter/Run/split/toggle/3-dot, flat tabs, 13 px title; (b) hover + active tab — rim appears, seam on split button is single-line; (c) open each popover class: workspace 3-dot (kit DropdownMenu), tab right-click (PopoverButton contextMenu), model picker (FRAME), command palette, tooltip — all read as one family: 90 % fill, blur, hairline, 12 px radius, 28 px rows, muted shortcuts, inset separators; (d) appearance presets small/large — tabs/actions scale with `--text-ui-sm`.
