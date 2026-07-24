# Overlay components census — popovers, menus, tooltips, dialogs/modals, sheets, toasts, hover cards

Scope: `apps/packages/ui/src`, `apps/packages/product-ui/src`, `apps/packages/product-client/src`,
`apps/desktop/src`. Tests excluded. Playground included only to flag clones of production patterns.
Repo head: `b395def3c302f54e92ad99c6121f5cc2a0c84034` (worktree `ui-catalog`).

Method: read every `kit/*` Radix wrapper, grepped every overlay-shaped export
(Popover/Dialog/Modal/Tooltip/Menu/Toast/Notice/HoverCard) across the four roots, then read
representative consumers of each primitive to check API/behavior/token adoption, and grepped
import counts for adoption tallies. Counts below are import-site counts (`grep -rl`), not
usage-site counts, and exclude `.test.` files.

---

## Headline finding before the families: this domain is in unusually good shape

Almost the whole overlay surface already funnels through one of five canonical primitives in
`apps/packages/ui/src`:

- `kit/Popover.tsx`, `kit/Dialog.tsx`, `kit/AlertDialog.tsx`, `kit/DropdownMenu.tsx`,
  `kit/ContextMenu.tsx`, `kit/Tooltip.tsx` — thin Radix wrappers, all sharing
  `POPOVER_FRAME_CLASS`/`POPOVER_SURFACE_CLASS` (`primitives/popover-surface.ts`) for chrome and
  the design-token z-scale (`--z-popover: 50`, `--z-tooltip: 70`, `--z-overlay: 40`,
  `--z-toast: 60`, defined in `apps/packages/design/src/tokens.ts`).
- `primitives/PopoverButton.tsx` — the app-level popover controller (trigger modes, virtual
  anchor for context-menu/double-click, native-overlay registration, focus-neutral open/close) —
  by far the dominant popover pattern (51 import sites).
- `primitives/ModalShell.tsx` — the app-level modal controller (close button, Escape shielding,
  disableClose, telemetry-block) built on `kit/Dialog` — the dominant modal pattern (15 sites),
  with `primitives/ConfirmationDialog.tsx` as its confirm-flow specialization.
- `kit/Sonner.tsx` (`Toaster`/`toast`) + `feedback/product-toast.tsx` (`showProductToast`) — one
  toast presentation for the whole product, explicitly documented as replacing three prior looks.

The one real duplication family below (composer popovers) is not itself a bespoke visual —
it's a second **implementation** of the same job the canonical `PopoverButton` already does, and
it lives in code that traced out as orphaned (see Family 1).

---

## Family 1 — Composer inline popovers: `ComposerPopoverSurface` (bespoke) vs `PopoverButton` (canonical)

**Members:**

- `apps/packages/product-ui/src/chat/composer/ComposerPopoverSurface.tsx:9` (export
  `ComposerPopoverSurface`) + `useDismissComposerPopover.ts:3` — a plain `<div>` surface with the
  same visual recipe as `POPOVER_FRAME_CLASS` (bg-popover/90, ring-[0.5px], rounded, backdrop
  blur) but **hand-rolled positioning/dismissal**: consumers keep their own `useState` open flag,
  `position: absolute` + manual `z-30`/`z-popover`/`z-raised` on the surface, and a
  `pointerdown`/`focusin`/`Escape` document-listener hook instead of Radix Popover.
  - Consumers using the hand-rolled pattern directly: `CloudChatSingleControl.tsx:93`,
    `CloudChatModelConfigControl.tsx:94,124` (nested submenu via a second absolutely-positioned
    surface at `z-raised`).
  - Consumers using `ComposerPopoverSurface` only as a **styling shell inside** a canonical
    `PopoverButton`/Radix `PopoverPrimitive.Content` (no bespoke dismiss logic — these are fine):
    `GoalBar.tsx:234` (inside `PopoverButton`), `ActivityAggregatePopover.tsx`,
    `PlanHandoffModePicker.tsx`, `ComposerIntegrationsControl.tsx`, `ComposerModelSelectorControl.tsx`,
    `WorkspaceActivityComposerCard.tsx`, `WorkspaceStatusComposerControl.tsx`,
    `DelegatedWorkComposerControl.tsx`, `ActivityChips.tsx`.
- `apps/packages/ui/src/primitives/PopoverButton.tsx:54` (export `PopoverButton`) — Radix
  `Popover.Root`/`PopoverPrimitive.Content`, `modal` (focus-trap + outside-click-blocks-activation
  parity), `onOpenAutoFocus`/`onCloseAutoFocus` neutralized, native-overlay registration wired,
  trigger modes (click/doubleClick/contextMenu) with a virtual anchor for cursor-anchored opens.

**How they differ:**
- API: `PopoverButton` takes `trigger`/children-as-render-prop/`align`/`side`/`offset`/
  `triggerMode`/`externalOpen`; the hand-rolled pair takes no equivalent — each consumer
  reimplements its own `open`/`search`/`activeSubmenuId` state and its own outside-click hook.
- Dismiss/focus: `PopoverButton` gets Radix's real focus trap plus a `modal` outside-pointer
  shield (documented: outside click dismisses *and does not* also activate what's under the
  cursor). The hand-rolled surfaces rely on `useDismissComposerPopover`'s capture-phase
  `pointerdown`/`focusin` listeners — no focus trap, so Tab can walk out of the popover into the
  page while it's visually open, and an outside click both closes the popover *and* fires normally
  on whatever's underneath (no shield).
- Positioning: `PopoverButton` is Radix-anchored (`side`/`align`/`sideOffset`, viewport
  collision-aware). The hand-rolled pair is `absolute bottom-full`/`right-0`, so it does not
  reposition on collision and the nested submenu in `CloudChatModelConfigControl` is a second
  manually-offset `absolute` layer (`left-[calc(100%+0.25rem)]`) rather than a Radix submenu.
- Native-overlay registration: `PopoverButton` calls `useNativeOverlayRegistration(open)` (drives
  desktop-global Escape/shortcut suppression while any overlay is open). The hand-rolled surfaces
  never register, so a `CloudChatSingleControl` popover open would not suppress those globals.
- z-token discipline: `PopoverButton`'s Radix content is always `z-50` (`z-popover`). The
  hand-rolled surfaces sprinkle `z-30`, `z-popover`, `z-raised` ad hoc across three different call
  sites for what is conceptually the same layer.

**Adoption:**
- `PopoverButton`: 51 files.
- `ComposerPopoverSurface` used as bespoke controller (not inside a `PopoverButton`): 2 files
  (`CloudChatSingleControl.tsx`, `CloudChatModelConfigControl.tsx`).

**Is this even live code?** Traced every consumer of `CloudChatComposer`/`CloudChatSurface`/
`CloudChatSingleControl`/`CloudChatModelConfigControl`/`NewChatSurface`/`AutomationCreatePanel`
(the whole tree these two live in) across `apps/web`, `apps/desktop`, `apps/mobile`, and
`apps/packages/product-client`. The only non-test reference anywhere in the repo is
`apps/packages/product-client/src/components/playground/loading/PlaygroundLoadingStates.tsx`
(a playground fixture) plus the package's own `package.json` export map. Nothing in the shipping
desktop/web/mobile app trees imports this composer family — the real composer (used by
`ComposerModelSelectorControl.tsx`, `ComposerIntegrationsControl.tsx`, etc., all under
`apps/packages/product-client/src/components/workspace/chat/input/`) already uses canonical
`PopoverButton` end-to-end. This looks like an earlier/parallel composer implementation that
lost the cutover.

**Recommendation:** delete `CloudChatSingleControl.tsx` and `CloudChatModelConfigControl.tsx`
(and their only other consumers `CloudChatComposer.tsx`/`CloudChatSurface.tsx`/
`NewChatSurface.tsx`/`AutomationCreatePanel.tsx` if nothing else anchors them) rather than
reconcile — they duplicate a job the shipping composer controls already do correctly on the
canonical primitive. If any piece turns out to be a genuine in-flight replacement, migrate it onto
`PopoverButton` before keeping it; do not keep two dismiss/focus models for the same composer
popover job.

---

## Family 2 — Menu content: `PopoverButton` + `PopoverMenuItem` vs `kit/DropdownMenu`

**Members:**
- `PopoverButton` (see Family 1) + `apps/packages/ui/src/primitives/PopoverMenuItem.tsx:20`
  (export `PopoverMenuItem`) — a plain `<button>` row (not a Radix menu-item), density/variant
  props, `stopPropagation` on click, codex hover-glyph recipe. Used for essentially every
  "3-dot"/context-style menu in the product: `PaneOptionsMenu.tsx`, `OpenTargetMenu.tsx`,
  `FilePathContextMenuContent.tsx`, `ChatDiffLineWrapContextMenu.tsx`, `TabContextMenu.tsx`,
  `CoworkSessionActionsMenu.tsx`, `AutomationRunLocationMenu.tsx`,
  `SidebarAccountFooter.tsx`, `GitReviewBaseSelector.tsx`/`GitReviewTargetSelector.tsx`,
  `AgentHarnessModelSelector.tsx`, `OrganizationSelectMenu.tsx`, `RepoPicker.tsx`, etc.
  (33 files import `PopoverMenuItem` directly).
- `apps/packages/ui/src/kit/DropdownMenu.tsx` (export `DropdownMenu`/`DropdownMenuContent`/
  `DropdownMenuItem`/… ) — the real Radix `react-dropdown-menu` primitive: roving-focus
  `Item`s, `Escape`/typeahead keyboard nav, `data-highlighted` styling, checkbox/radio/sub-menu
  variants Radix owns natively. Used by 4 files: `WorkspaceItemMenu.tsx`,
  `RightPanelNewTabMenu.tsx`, `WorkspaceActionsMenu.tsx`, and `ProposedPlanCard.tsx`
  (product-ui).

**How they differ (this is the real API/a11y gap, not just styling):**
- `PopoverMenuItem` renders a bare `<button>` inside `PopoverPrimitive.Content` (a generic
  dialog-role popover, not `role="menu"`). It has no roving `tabIndex`/arrow-key navigation
  between rows, no typeahead, and no Escape-to-close-then-refocus-trigger contract beyond what
  `PopoverButton` gives for free — each consumer that wants keyboard row-to-row navigation has to
  hand-roll it (e.g. `ComposerModelSelectorControl.tsx` pulls in a bespoke
  `useModelPickerKeyboardNav` hook to get arrow-key behavior that `DropdownMenuItem` would give
  it natively).
- `kit/DropdownMenu`'s `DropdownMenuContent` supports `data-autofocus` on items (used by
  `RightPanelNewTabMenu.tsx` and `WorkspaceItemMenu.tsx`'s sibling menus) plus real
  `DropdownMenuCheckboxItem`/`DropdownMenuRadioItem`/`DropdownMenuSub` — none of which
  `PopoverMenuItem` has an equivalent for (selection state is always emulated with a trailing
  `<Check>` icon instead of `aria-checked`/`role="menuitemcheckbox"`).
- Both share `POPOVER_FRAME_CLASS` chrome and the same `animate-popover-in` entrance, so there is
  no visual-language split — this is a genuine capability split, not a skin split.

**Which is closer to canonical:** `kit/DropdownMenu` is the more complete/a11y-correct menu
primitive (real ARIA menu semantics, roving focus, checkbox/radio/sub built in) — but
`PopoverMenuItem`/`PopoverButton` is what 33+ menu call sites already standardized on, largely
because those menus need the virtual-anchor/context-menu/double-click trigger modes that
`kit/DropdownMenu`'s trigger doesn't offer, and because several (`WorkspaceItemMenu`,
`WorkspaceActionsMenu`, `RightPanelNewTabMenu`) specifically need `kit/DropdownMenu` as the
in-browser **fallback** behind a desktop-native menu (`useNativeContextMenu`/
`showNativeMenu`) — a role `PopoverButton`'s own `triggerMode="contextMenu"` fallback also serves
elsewhere (see Family 3). The two are not accidental duplicates so much as two menu roles that
never got unified: "always-DOM menu with custom row content" (`PopoverMenuItem`) vs. "ARIA menu
with a native-menu companion" (`kit/DropdownMenu`).

**Adoption:** `PopoverMenuItem` 33 files / `PopoverButton` 51 files vs `kit/DropdownMenu` 4 files.

**Recommendation:** keep both, but narrow the boundary: reserve `kit/DropdownMenu` for menus that
pair with a native-menu fallback (the 4 current sites already do this correctly) and route every
other options/actions menu through `PopoverButton`+`PopoverMenuItem` as today. The debt worth
paying down is `PopoverMenuItem`'s missing ARIA menu semantics (`role="menuitem"`,
`aria-checked` for the trailing-check selection pattern used in ~10 of the 33 sites) rather than
migrating call sites — that would close the real a11y gap without a mass rewrite.

---

## Family 3 — Context-menu trigger: `PopoverButton triggerMode="contextMenu"` vs `kit/ContextMenu` (unused) vs native bridge

**Members:**
- `PopoverButton`'s `triggerMode="contextMenu"` + virtual anchor (see Family 1) — used for every
  actual right-click menu in the DOM fallback path: `FileViewerFrame.tsx`,
  `ChatDiffLineWrapContextMenu.tsx`, `TabGroupPillWithMenu.tsx` (via `TabContextMenu`).
- `apps/packages/ui/src/kit/ContextMenu.tsx` — a full Radix `react-context-menu` wrapper
  (`ContextMenu`/`ContextMenuTrigger`/`ContextMenuContent`/checkbox/radio/sub variants), styled
  identically to `kit/DropdownMenu`. **Zero non-test consumers anywhere in the four search
  roots** — it is fully built but never imported.
- Desktop-native path: `apps/packages/product-client/src/hooks/ui/native/use-native-context-menu.ts`
  (`useNativeContextMenu`/`useNativeMenu`) + `apps/desktop/src/lib/access/tauri/context-menu.ts` —
  intercepts the same `contextmenu` event ahead of the DOM fallback and shows an OS-native menu
  via the Tauri bridge, falling back to letting the DOM listener fire if the native menu can't be
  shown. This is the same "native-first, Radix/DOM as browser/test fallback" shape as Family 2's
  `kit/DropdownMenu` + `useWorkspaceActionsNativeMenu`/`useWorkspaceTabNativeContextMenu` pairing.

**How they differ:** `kit/ContextMenu` would give real `contextmenu`-triggered Radix positioning
(cursor-anchored, `Escape`/outside-click, ARIA menu semantics) for free. `PopoverButton`'s
`contextMenu` trigger mode reimplements the same cursor-anchoring by hand (`pointRef` +
`virtualAnchorRef.getBoundingClientRect()`) on top of the *click* popover primitive rather than a
purpose-built context-menu primitive — it works, but it's a parallel, hand-rolled reimplementation
of exactly what `kit/ContextMenu` already provides, and it inherits `PopoverButton`'s generic
`role`-less content rather than `kit/ContextMenu`'s real ARIA menu semantics discussed in Family 2.

**Adoption:** `PopoverButton triggerMode="contextMenu"` — 3 files. `kit/ContextMenu` — 0 files.

**Recommendation:** delete `kit/ContextMenu.tsx` (dead code, not a sanctioned member) unless a
near-term consumer is planned; if context-menu ARIA semantics matter enough to fix, do it by
migrating the 3 `contextMenu`-trigger-mode call sites onto `kit/ContextMenu` rather than
maintaining a from-scratch cursor-anchor reimplementation inside `PopoverButton`.

---

## Family 4 — Modal/dialog wrapper: `ModalShell` (canonical) vs raw `kit/Dialog` vs `kit/AlertDialog`

**Members:**
- `apps/packages/ui/src/primitives/ModalShell.tsx:36` (export `ModalShell`) — built on
  `kit/Dialog`, adds: close button with `disableClose`, Escape always shielded (
  `event.preventDefault()` then explicit `onClose`, "parity with the old hand-rolled shell"),
  `data-telemetry-block`, header/body/footer slot classes, native-overlay registration. **15
  import sites** (`ApiKeyCreatorModal`, `ProviderPickerModal`, `SendFeedbackModal`,
  `SubmitPromptModal`, `UpgradeGateDialog`, `BillingPlanManagementDialog`,
  `RuntimePressureDetailsDialog`, `RepoSetupModal`, `WorkspaceReconciliationDialog`'s sibling
  `SecretEditorDialog`/`SecretDeleteDialog`, `WorkflowDefinitionEditor`,
  `OrganizationSsoSettingsSurface`, and via `ConfirmationDialog`).
- `apps/packages/ui/src/primitives/ConfirmationDialog.tsx:17` (export `ConfirmationDialog`) — a
  `ModalShell` specialization for the confirm/cancel two-button flow (14 import sites:
  `SidebarAccountFooter`, `OrganizationSwitchDialog`, `ApiKeysPane`, `UserIntegrationsPane`,
  `CurrentUserInvitationsSection`, `RepoGroup`, `MainSidebar`, `AutomationEditorDialog`,
  `RuntimePressureDetailsDialog`, `WorkflowDefinitionEditor`, `SecretDeleteDialog`,
  `OrganizationSsoSettingsSurface`, playground x2).
- `apps/packages/ui/src/kit/Dialog.tsx` used **directly** (bypassing `ModalShell`) by 6
  non-`ModalShell` files: `IntegrationConnectDialog.tsx`, `AddCustomIntegrationDialog.tsx`,
  `KeyboardShortcutsDialog.tsx`, `CloudRepoActionDialogHost.tsx`, `CloudRepoPicker.tsx`
  (repo picker's own `CloudRepoPickerDialog`), `AddRepoFlow.tsx`. These are simple form/search
  dialogs that don't need `ModalShell`'s close-button/telemetry-block/Escape-shield extras — each
  gets `DialogContent`'s default close button and standard Escape-closes-normally behavior for
  free, which is a legitimate, smaller-surface alternative rather than a copy of `ModalShell`.
- `apps/packages/ui/src/kit/AlertDialog.tsx` used by 2 files: `WorkspaceReconciliationDialog.tsx`,
  `WorkspaceAvailabilityActionHost.tsx`. **Gap found:** `AlertDialogOverlay`/`AlertDialogContent`
  in `kit/AlertDialog.tsx` do **not** apply `modal-overlay-animated`/`modal-panel-animated` (the
  entrance-motion classes `kit/Dialog.tsx` uses) — so these two alert dialogs pop in with no
  entrance transition while every `kit/Dialog`/`ModalShell` dialog animates in. Same
  `bg-background`/`shadow-modal` panel recipe otherwise, so visually consistent except for that
  missing motion.

**How they differ:** `ModalShell` is the "product modal" contract (close affordance, telemetry
gate, Escape-always-shielded) that most real feature dialogs want; raw `kit/Dialog` is the
correct choice for a handful of simple, low-ceremony dialogs; `kit/AlertDialog` is reserved for
the two "irreversible action, must choose Cancel/Confirm" flows that specifically want Radix's
alert-dialog semantics (`AlertDialogAction`/`AlertDialogCancel`, no dismiss-by-overlay-click by
default) instead of `ConfirmationDialog`'s ordinary-dialog-based confirm pattern.

**Adoption:** `ModalShell` 15 / `ConfirmationDialog` 14 / raw `kit/Dialog` 6 / `kit/AlertDialog` 2.

**Recommendation:** keep all three — they're roles, not accidental duplicates (full-featured
product modal / plain form dialog / true alert-dialog for irreversible confirms) — but fix the
`kit/AlertDialog.tsx` entrance-motion gap by adding `modal-overlay-animated`/`modal-panel-animated`
to `AlertDialogOverlay`/`AlertDialogContent` so the two alert dialogs animate in consistently with
every other modal in the product.

---

## Family 5 — Toasts and lifecycle "toast-shaped" notices

**Members:**
- `apps/packages/ui/src/kit/Sonner.tsx` (export `Toaster`, re-exports `toast` from `sonner`) —
  the single toast container/theme, `expand` always on, kit classNames applied to every toast.
- `apps/packages/product-client/src/components/feedback/product-toast.tsx:16`
  (`showProductToast`) — the one ad-hoc/legacy toast entry point; its own comment states it
  intentionally replaced what used to be three different toast looks, and every
  `useToastStore().show(...)` call (~190 legacy sites per its comment) now routes here.
- `apps/packages/product-client/src/stores/toast/toast-store.ts` (`useToastStore`) — kept only
  as a call-site-compatible facade over `showProductToast`; renders nothing itself.
- `UpdateToastPresenter.tsx` / `HarnessUpdateToastPresenter.tsx` — both call `toast(...)`/
  `toast.custom(...)` directly from `kit/Sonner`, not through `showProductToast` (correct: they
  need `id`, `duration: Infinity`, `action`/`cancel` button pairs, and `HarnessUpdateToastPresenter`
  needs a fully custom card body via `toast.custom`). These are lifecycle progress/action toasts,
  a materially different job (persistent, actionable, id-addressable) from the fire-and-forget
  `showProductToast` message, and both already share the one Sonner container/theme — no
  duplication here, just two legitimate calling conventions against the same primitive.

**Adoption:** effectively total — one `Toaster`, one legacy facade, two lifecycle presenters that
use the raw API directly for good reason.

**Recommendation:** no action. This is the one part of the domain that already fully executed
"cull duplicates, one sanctioned toast."

---

## Family 6 — Inline/ambient notice blocks ("toast vs update-banner vs inline notice")

These are NOT overlay-portaled — they're static `<div>` blocks rendered in normal layout flow
(no z-index, no portal, no dismiss-by-outside-click). Flagging because the charter explicitly asks
to check this seam against toast/dialog, and because there are visibly 4+ near-identical
"tone-colored bordered box with icon + title + description" implementations that never converged
on one component:

- `apps/packages/product-ui/src/layout/ProductNotice.tsx:21` (export `ProductNotice`) — generic
  4-tone (`neutral`/`info`/`warning`/`destructive`) notice box, `rounded-lg border p-4`, icon +
  title + description. The most complete/generic API of the group (has a real tone enum,
  optional icon/title).
- `apps/packages/product-ui/src/billing/BillingUiParts.tsx:54` (export `Notice`) — 2-tone
  (`warning`/`destructive`) box with the same anatomy (icon + title + description) plus an
  optional trailing `BillingButton` action — `ProductNotice` has no action slot, so this one
  isn't a strict subset.
  own action button. `AlertTriangle` icon is hardcoded (not a prop) unlike `ProductNotice`.
- `apps/packages/client/.../HarnessConfigIssueBanner.tsx` — bespoke warning/destructive box,
  hardcoded `border-warning/30 bg-warning/5`, own icon-in-a-tinted-square treatment, `Badge` for
  status — same "tone-tinted bordered box with icon+text" shape as `ProductNotice`/`Notice` but
  written from scratch with a different tone-to-class mapping and no shared tone enum.
- `apps/packages/product-ui/src/chat/ClaimBanner.tsx` — another bespoke bordered box (2 variants:
  neutral `border-border bg-card` / info `border-info/40 bg-info/10`), own inline action button,
  not built on `ProductNotice`/`Notice`.
- `GitPanelReviewChrome.tsx`'s `GitReviewDiffPolicyNotice` — yet another bespoke bordered box
  (`border-sidebar-border/70 bg-surface-elevated-secondary`), sidebar-toned variant of the same
  shape, no icon.
- `SecretScopeNotice.tsx` — degenerate case, just a `<p>` (no border/box at all) — genuinely a
  different, lighter-weight role (inline caption text), fine as its own thing.
- `QueuedPromptEditBanner.tsx` / `ReleaseNoticeCard.tsx` — action-row/dismissible-card banners,
  each with its own one-off styling; these read as legitimately distinct components (composer
  editing-state row; sidebar dismissible release announcement with its own dismiss/changelog
  actions) rather than notice-box duplicates, so not folded into the count below.

**Adoption:** `ProductNotice` — used inside `product-ui` billing/settings surfaces (grep shows it
referenced from within `product-ui` itself; no cross-package importer found beyond its own
package). `Notice` (billing) — used only inside `BillingPlanComparison.tsx`/billing surfaces.
`HarnessConfigIssueBanner`, `ClaimBanner`, `GitReviewDiffPolicyNotice` — one call site each.

**Which is closest to canonical:** `ProductNotice` has the best generic API (4-tone enum,
optional icon/title, description required) and is the natural consolidation target, but it's
missing the action-slot that `Notice` (billing) and `ClaimBanner` both need — that's the one real
gap blocking a merge, not styling.

**Recommendation:** add an optional `action`/`children` slot to `ProductNotice`, then fold
billing's `Notice`, `HarnessConfigIssueBanner`'s box, and `ClaimBanner`'s bordered box onto it
(pass tone + optional action); keep `GitReviewDiffPolicyNotice` separate (it's a sidebar-toned,
icon-less micro-variant inside a dense review chrome, arguably fine as-is) and keep
`SecretScopeNotice` as a plain caption (not a notice box at all, no change needed).

---

## Family 7 — Hover cards: `DelegatedAgentHoverCard` (only member) vs Radix `HoverCard`

**Members:**
- `apps/packages/product-client/src/components/workspace/shell/tabs/DelegatedAgentHoverCard.tsx:33`
  (export `DelegatedAgentHoverCard`) — a fully hand-rolled hover card: own `mouseenter`/
  `mouseleave`/`focus`/`blur` handlers, own `setTimeout`-based hide delay
  (`motion.delay.hoverCardHideMs`), own viewport-clamping position math, `createPortal` straight
  to `document.body`, styled with the same `POPOVER_FRAME_CLASS` as everything else. Reuses
  `Button` (`variant="unstyled"`) as the card root only when it's clickable
  (`onCardClick`), otherwise a plain `role="tooltip"` `<div>`.
- No Radix `@radix-ui/react-hover-card` anywhere in the four search roots (confirmed by grep) —
  this is the only hover-card-shaped component in the domain, so there is no duplication to
  resolve, but it's worth flagging as a **singleton that reimplements a Radix primitive** rather
  than a canonical `kit/HoverCard.tsx` (which doesn't exist).

**Adoption:** 2 files (`SubagentToolActionRow.tsx`, `ChatTabWithMenu.tsx`).

**Recommendation:** keep as-is for now (no second implementation to fold), but note for future
work: if a second hover-card need appears, this hand-rolled implementation is the wrong thing to
copy — it lacks Radix's built-in `openDelay`/`closeDelay`/collision handling that this component
reimplements by hand (viewport clamp, hide-delay timer). A `kit/HoverCard.tsx` Radix wrapper
following the existing `kit/Tooltip.tsx` shape would be the more sanctioned base if that need
arises; today there's nothing to consolidate.

---

## Singletons (fine as-is — listed for coverage)

- `apps/packages/ui/src/primitives/Tooltip.tsx` (`Tooltip`) — the one app-level tooltip wrapper
  over `kit/Tooltip`; 16 import sites all route through it. One direct `kit/Tooltip` bypass
  (`StatusCardPrimitives.tsx`) is justified — it needs a non-string, structured hover-detail body
  the wrapper's `content: string` API can't express.
- `apps/packages/ui/src/primitives/PickerPopoverContent.tsx` / `PopoverSearchField.tsx` — shared
  search+list body slotted into `PopoverButton` popovers (`EnvironmentSearchSelect`,
  `HomeTargetPicker`, `HomeProjectMenu`, `AutomationAgentRunConfigPicker`, `KeyboardShortcutsDialog`).
  One shape, reused correctly.
- `apps/packages/ui/src/primitives/SettingsMenu.tsx` — grouped popover-select control (3 sites:
  `GeneralPane`, `AppearancePane`, `SecretEditorDialog`); a `PopoverButton` composition, not a
  parallel primitive.
- `apps/packages/ui/src/primitives/EnvironmentSearchSelect.tsx` — searchable single-select
  popover (3 sites); also a `PopoverButton` composition.
- `apps/packages/ui/src/primitives/CommandPalette.tsx` (`CommandPaletteRoot`) — `cmdk`-based,
  its own portal/focus-restore/native-overlay-registration; genuinely a different interaction
  model (global fuzzy command search) from every dialog/popover above, correctly not built on
  `kit/Dialog`. One production consumer (`WorkspaceCommandPalette.tsx`).
- `apps/desktop/src/lib/access/tauri/context-menu.ts` /
  `apps/packages/product-client/src/hooks/ui/native/use-native-context-menu.ts` — the
  native-menu bridge + capability hook backing Family 2/3's native-first menus; correctly a bridge
  layer, not a UI component.
- `AddRepoFlow.tsx` / `CloudRepoPicker.tsx`'s `CloudRepoPickerDialog` — raw `kit/Dialog` hosts for
  the cloud repo picker; legitimately two different hosts (unified desktop add-repo flow vs.
  standalone picker dialog) sharing one presentational body (`CloudRepoPicker` itself), not a
  dialog-wrapper duplicate.
- `ReleaseNoticeCard.tsx` / `QueuedPromptEditBanner.tsx` — one-off dismissible/action banners, own
  narrow roles, no sibling to fold into.
- `GoalBarResultPopover.tsx` — popover *content* (not a wrapper), correctly slotted into
  `PopoverButton` from `GoalBar.tsx`.
- `mobile`'s `MobileWorkspaceActionSheet.tsx` (React Native `Modal` + `Pressable` scrim) — a
  genuinely separate platform (React Native, not DOM/Radix), correctly not sharing the web
  `ModalShell`/`kit/Dialog` stack. Out of primary scope (mobile isn't one of the four search
  roots) but confirmed as a distinct, non-duplicate role.

---

## Summary table

| Family | Canonical keeper | Fold in | Delete | Adoption (keeper) |
|---|---|---|---|---|
| 1. Composer popovers | `PopoverButton` | — | `ComposerPopoverSurface`-as-controller + `CloudChatSingleControl`/`CloudChatModelConfigControl` (orphaned tree) | 51 files |
| 2. Menu content | Both (different roles) | — | — (close `PopoverMenuItem` ARIA gap instead) | 33 / 4 files |
| 3. Context-menu trigger | `PopoverButton` contextMenu mode | — | `kit/ContextMenu.tsx` (0 consumers) | 3 files |
| 4. Modal wrapper | `ModalShell` (+ raw `Dialog`, `AlertDialog` as distinct roles) | — | — (fix `AlertDialog` missing entrance motion) | 15 / 14 / 6 / 2 files |
| 5. Toasts | `kit/Sonner` + `showProductToast` | — | — (already consolidated) | ~all |
| 6. Inline notices | `ProductNotice` | billing `Notice`, `HarnessConfigIssueBanner`, `ClaimBanner` | — | needs action-slot first |
| 7. Hover cards | `DelegatedAgentHoverCard` | — | — (singleton) | 2 files |
