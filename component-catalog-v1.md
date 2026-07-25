> **SUPERSEDED 2026-07-25** by `component-catalog-v2.md` (coherent rewrite: architecture governs from the top, reviewer errata verified and fixed, decisions renumbered). Kept for provenance only.

# Component catalog v1 — pre-cull survey

Base: `origin/main` @ `c0dd0e32b` (worktree `foundation-recon`, read-only recon).
Scope: `apps/packages/ui/src/`, `apps/packages/product-ui/src/`,
`apps/packages/product-surfaces/src/`, `apps/packages/product-client/src/components/`
(shared/reusable pieces only — one-off page compositions in `product-client` are
excluded except where they duplicate a reusable job).

**Counting method**: for each package's public `exports` subpath (from its
`package.json`), `grep -rlE 'from ["\']@<pkg>/<subpath>["\']'` across `apps/`,
excluding `node_modules`, `dist`, `.test.`/`.spec.`/`.stories.` files, and the
component's own source file. For files not exposed as a subpath export (barrels,
internal detail modules, `product-client`'s own components which are consumed via
`#product/*` or relative imports), the same grep is re-run against relative/alias
import forms scoped to the consuming package. Every "0 importers" claim below was
double-checked with a second grep for internal (same-package relative-import)
consumption before being called dead — two cases (`lib/utils`, `kit/Popover`,
`MarkdownContentSearchMarks`) flip from "0" to "internal-only, not dead" this way;
those are called out explicitly. Counts are components, not occurrences — a file
importing the same symbol twice counts once.

---

## 1. Sanctioned set (keep) — one component per job

### Buttons

| Path | Importers | Role |
|---|---|---|
| `ui/src/primitives/Button.tsx` | 240 | The one button. `variant`/`size` props cover primary/ghost/destructive/icon/unstyled. |
| `ui/src/primitives/IconButton.tsx` | 21 | Icon-only button, general purpose (tone: default/sidebar). |
| `ui/src/layout/PaneIconButton.tsx` | 4 | Icon-only button scoped to pane headers (sidebar-toned, `size-6`, built on `Button`). Narrow specialization of IconButton's job, not a rival — low risk, no action needed. |
| `ui/src/layout/SidebarActionButton.tsx` | 5 | Sidebar-section action button (e.g. "+ Add repo"). |

### Menus (RULED — see §2a)

| Path | Importers | Role |
|---|---|---|
| `ui/src/primitives/PopoverButton.tsx` | 51 | Sanctioned popover/menu/context-menu trigger. Supports `trigger="click"\|"doubleClick"\|"contextMenu"` — this is also how right-click context menus are built (no separate context-menu primitive is used product-wide). |
| `ui/src/primitives/PopoverMenuItem.tsx` | 33 | Sanctioned menu row, paired with `PopoverButton`. |
| `ui/src/primitives/SettingsMenu.tsx` | 3 | Composite select-style menu built *on top of* PopoverButton/PopoverMenuItem (not a rival system). |
| `ui/src/primitives/EnvironmentSearchSelect.tsx` | 3 | Composite searchable-picker menu, also built on PopoverButton/PopoverMenuItem/PickerPopoverContent. |
| `ui/src/primitives/PickerPopoverContent.tsx` | 3 | Shared popover-content shell for search-style pickers (Home target picker, agent-run-config picker). |

### Dialogs (RULED — two tiers, both stay)

| Path | Importers | Tier / role |
|---|---|---|
| `ui/src/primitives/ConfirmationDialog.tsx` | 14 | **Product tier.** Styled confirm/cancel dialog built on `ModalShell` + `Button`; used for "are you sure" flows with product chrome. |
| `ui/src/kit/AlertDialog.tsx` | 2 (`WorkspaceReconciliationDialog`, `WorkspaceAvailabilityActionHost`) | **Primitive tier.** Bare Radix AlertDialog wrapper, minimal chrome; used for the two workspace-availability interrupt flows. |
| `ui/src/primitives/ModalShell.tsx` | 15 | The general custom-dialog shell (arbitrary content, not just confirm/cancel) — every bespoke modal in the product (`RepoSetupModal`, `PlanHandoffDialog`, `PublishDialog`, `UpdateRestartDialog`, etc.) is built on this. |
| `ui/src/kit/Dialog.tsx` | 6 | Raw Radix Dialog wrapper — used directly by a handful of settings/integration dialogs and two `product-ui` repo dialogs that predate `ModalShell` consolidation. Not banned by any ruling, but a candidate for the open-decisions list (§4). |

### Tooltips

| Path | Importers | Role |
|---|---|---|
| `ui/src/primitives/Tooltip.tsx` | 16 | The one tooltip: string content, single/multi-line, wraps `kit/Tooltip`. |
| `ui/src/kit/Tooltip.tsx` | 1 direct (`StatusCardPrimitives.tsx`) + internal (used by `primitives/Tooltip`) | Radix primitive layer. Not itself the sanctioned surface for content — only bypassed once, for a case needing raw trigger/content composition. |

### Text inputs

| Path | Importers | Role |
|---|---|---|
| `ui/src/primitives/Input.tsx` | 54 | The one single-line text input. |
| `ui/src/primitives/Textarea.tsx` | 19 | The one plain multi-line textarea (forms, prompt boxes). |
| `ui/src/primitives/ComposerTextarea.tsx` | 4 | Chat-composer-specific textarea (auto-grow, composer chrome). |
| `ui/src/primitives/ComposerTextareaFrame.tsx` | 6 | Frame/chrome wrapper around composer textarea variants. |
| `ui/src/primitives/Label.tsx` | 27 | Form label. |

### Selects / pickers

| Path | Importers | Role |
|---|---|---|
| `ui/src/primitives/Select.tsx` | 14 | Native `<select>` wrapper — plain dropdown lists (org roles, budgets, workflow field types). |
| `ui/src/primitives/EnvironmentSearchSelect.tsx` | 3 | Rich searchable picker (popover + search + checkmarks) for larger option sets. |
| `ui/src/primitives/RadioCardGroup.tsx` | 1 | Card-style radio group (single current consumer: `WorkspaceAvailabilityActionHost`). |

### Tabs / scope switchers

| Path | Importers | Role |
|---|---|---|
| `product-ui/src/settings/SettingsScopeTabs.tsx` | 1 (`SettingsSidebar` via `product-client`) + `ProductSidebarNavigation` internal | Underline scope tabs (User/Org/Repo/Agents), built on `ui/Button`. This is the live "tabs" look in Settings. |
| `ui/src/primitives/Tabs.tsx` | **0** | Pill-style tab group with its own chrome (`border`, `bg-card`). Dead — see §3. |

### Toasts

| Path | Importers | Role |
|---|---|---|
| `ui/src/kit/Sonner.tsx` | 4 direct + funnels the whole toast system | The one toast surface (`Toaster` + `toast()`), themed Sonner wrapper. |
| `product-client/src/components/feedback/product-toast.tsx` | ~190 legacy call sites via `useToastStore` (per its own doc-comment) + direct callers | Thin `showProductToast()` convenience wrapper over `kit/Sonner`'s `toast()` — not a second system. |
| `product-client/src/components/feedback/UpdateToastPresenter.tsx`, `HarnessUpdateToastPresenter.tsx` | lifecycle-specific | Both render into the same `kit/Sonner` toast container; different call sites for the update/harness lifecycle, same visual system. |

### Empty states

| Path | Importers | Role |
|---|---|---|
| `product-ui/src/settings/SettingsEmptyState.tsx` | 16 | The Settings-scope empty/placeholder state (flat, centered, CONTRACT §6). |
| `product-client/src/components/workspace/git/GitReviewEmptyState.tsx` | 3 (`PlaygroundSidebarGitDiff`, `GitReviewInlineState`, `GitPanelReviewChrome`) | Git-review-panel-scoped empty/placeholder state (quieter, no icon tile) — different visual contract, scoped to one surface family. |
| `ui/src/layout/EmptyState.tsx` | **0** | Generic layout-level empty state. Dead — see §3. |

### Avatars (RULED — kit/Avatar deleted)

| Path | Importers | Role |
|---|---|---|
| `product-client/src/components/organizations/OrganizationAvatar.tsx` | 2 direct (`OrganizationLogo.tsx`, `SidebarAccountFooter.tsx`) + `organizationInitials()` helper reused by callers | The one org-avatar component (logo image or initials monogram, per its own doc-comment: "the single org avatar used across every surface"). |
| `ui/src/kit/Avatar.tsx` | 0 | **RULED deleted.** Radix Avatar wrapper, zero importers anywhere (external or internal). |

User avatars (person, not org) are rendered ad hoc as `<img src={avatarUrl}>` in 3+ places (`ProductSidebarAccountFooter`, `SidebarAccountFooter`, `AccountPane`) — there is no sanctioned user-avatar component today. Flagged in §4.

### Tables

| Path | Importers | Role |
|---|---|---|
| `ui/src/kit/Table.tsx` | **0** | Styled Radix-adjacent table primitives (`Table`, `TableRow`, etc). Dead — see §3. |
| `product-ui/src/settings/ModelTable.tsx` | 1 (`ModelConfigGrid`-adjacent settings surface) | The one real table in the product — hand-rolls raw `<table>` markup instead of using `kit/Table`. There is effectively no sanctioned reusable table component; `ModelTable` is a one-off. Flagged in §4. |

### Skeletons / loading

| Path | Importers | Role |
|---|---|---|
| `ui/src/primitives/Skeleton.tsx` | 7 (incl. `product-surfaces` billing panels, `CloudRepoPicker`, `CloudChatTranscriptLoadingState`, `CloudWorkspaceList`, `WorkspaceInventory`) | The one skeleton/shimmer block. |
| `ui/src/primitives/Spinner.tsx` | 2 (`HarnessUpdateToastPresenter`, `WorkspacesCommandList`) | The one spinner glyph. |
| `ui/src/primitives/ThinkingText.tsx` | 2 direct (`product-client` barrel, `CloudChatTranscriptRowItems`) + 8 more via the `product-client` barrel re-export | "Agent is working" gleam-text treatment. |
| `product-client/src/components/feedback/LoadingIllustration.tsx` | 4 (`UserPreferencesGate`, `PlaygroundLoadingStates`, `FileViewerContent`, `FileEditorView`) | Distinct job: full illustrated loading state, not a shimmer skeleton. Not a duplicate. |

### Badges / chips

| Path | Importers | Role |
|---|---|---|
| `ui/src/primitives/Badge.tsx` | 31 | The one badge/pill for status/count labels. |
| `product-ui/src/workspaces/PrStatusBadge.tsx` | 2 | PR-status-specific badge composition (built on top of `Badge`, not a rival). |

### Progress / level indicators

| Path | Importers | Role |
|---|---|---|
| `ui/src/primitives/ProgressBar.tsx` | 3 | The one determinate progress bar (updates, downloads). |
| `ui/src/primitives/LevelBarsButton.tsx` | 1 (`ComposerReasoningEffortBars`) | Distinct job: discrete level-selector control, not a progress display. |

### Switches / checkboxes

| Path | Importers | Role |
|---|---|---|
| `ui/src/primitives/Switch.tsx` | 11 | The one on/off setting switch. |
| `ui/src/primitives/Checkbox.tsx` (re-exports `kit/Checkbox`) | 10 | The one checkbox. `kit/Checkbox.tsx` holds the real Radix implementation; `primitives/Checkbox.tsx` is a 1-line re-export — same component, two entry points. |
| `ui/src/kit/Checkbox.tsx` (direct) | 1 (`product-ui/workflows/WorkflowInputEditor.tsx`) | Same as above — one consumer reaches the Radix layer directly instead of via `primitives/Checkbox`. Harmless, not a real fork. |

### Composer control buttons (chat input chrome)

| Path | Importers | Role |
|---|---|---|
| `ui/src/primitives/ComposerControlButton.tsx` | 17 | Chat-composer footer control pill (icon + label + detail + trailing), used across chat/automation composer chrome. |
| `ui/src/primitives/ComposerActionButton.tsx` | 2 | 28px solid-circle action button (send/stop), distinct visual job from the control pill. |
| `ui/src/primitives/PillControlButton.tsx` | 3 (all `automations/*`) | Near-identical API/markup to `ComposerControlButton` but for the automations editor's pill controls, predating a shared token palette. See §2 duplicate cluster. |

### Segmented controls

| Path | Importers | Role |
|---|---|---|
| `ui/src/primitives/SegmentedControl.tsx` | 7 | The one segmented-control toggle group. |

### Icons

| Path | Importers | Role |
|---|---|---|
| `ui/src/icons.tsx` (+ `icons/*.tsx` detail modules) | 197 | The one general icon set. |
| `ui/src/command-palette-icons.tsx` | 1 | Command-palette-specific glyph set. |
| `ui/src/proliferate-icons.tsx` | 6 | Brand mark glyphs. |
| `ui/src/provider-icons.tsx` | 9 | Auth/model provider logos (Claude, OpenAI, GitHub, etc). |

### Layout scaffolding

| Path | Importers | Role |
|---|---|---|
| `ui/src/layout/AutoHideScrollArea.tsx` | 18 | Scroll container with auto-hiding scrollbar. |
| `ui/src/layout/ShortcutBadge.tsx` | 8 | `<kbd>`-style shortcut hint, paired with menu rows and sidebar items. |
| `ui/src/layout/SidebarRowSurface.tsx` | 6 | Shared sidebar-row background/hover treatment. |
| `ui/src/layout/SidebarNavRow.tsx` | 2 (`SettingsSidebar`, `ProductSidebarNavigation`) | Sidebar nav row with icon/label/status/shortcut slots — supersedes `SidebarNavItem` (§3). |
| `ui/src/layout/PaneOptionsMenuItem.tsx` | 3 | Menu-item variant styled for pane "..." option menus (paired with `PopoverButton`, not `DropdownMenu`, in all 3 current call sites). |
| `product-ui/src/settings/SettingsPageHeader.tsx` | 25 | The Settings-scope page header (flat, CONTRACT §3). |
| `product-ui/src/settings/SettingsSection.tsx` | 28 | Settings-scope section wrapper. |
| `product-ui/src/settings/SettingsRow.tsx` | 15 | Settings-scope row (label + control). |
| `product-ui/src/settings/SettingsEyebrow.tsx` | 4 | Settings-scope small-caps section eyebrow label. |
| `product-ui/src/settings/SettingsSaveFooter.tsx` | 2 | Settings save/cancel sticky footer. |
| `product-ui/src/layout/ProductPageShell.tsx` (+ `ui/layout/PageHeader`, `ui/layout/PageContentFrame`) | 2 (`WorkflowDefinitionsAccessScreen`, `WorkflowResourceState`) | A *second*, narrower page-header/shell system used only by the workflows-access surfaces — not the Settings look. See §4 (arguable whether this should be folded into `SettingsPageHeader`'s family or kept separate).

---

## 2. Duplicates / overlaps

### 2a. Menu system — RULED

**Ruling (Pablo, already decided):** `PopoverButton` + `PopoverMenuItem` is the
sanctioned menu system. `kit/DropdownMenu` is banned for new use; its remaining
consumers migrate.

| Path | Importers | Notes |
|---|---|---|
| `ui/src/primitives/PopoverButton.tsx` + `PopoverMenuItem.tsx` | 51 / 33 | Survivor. |
| `ui/src/kit/DropdownMenu.tsx` | 4 | Migration set, fully enumerated: `WorkspaceItemMenu.tsx` (has `DropdownMenuShortcut` usage), `RightPanelNewTabMenu.tsx`, `WorkspaceActionsMenu.tsx` (has `DropdownMenuShortcut`), `product-ui/chat/transcript/ProposedPlanCard.tsx`. Migration work: replace `DropdownMenu`/`DropdownMenuContent`/`DropdownMenuItem`/`DropdownMenuTrigger` with `PopoverButton`/`PopoverMenuItem`; the two consumers using `DropdownMenuShortcut` need `ShortcutBadge` (already proven paired with `PopoverMenuItem` in `RepoGroup.tsx`, `WorkspaceItem.tsx`, `TerminalHeaderIcon.tsx`). Small, mechanical migration — 4 files. |
| `ui/src/kit/ContextMenu.tsx` | 0 | Not in the ruled migration set because it's already dead — right-click menus in the product (`FilePathContextMenuContent`, `TabContextMenu`, diff-line context menu) are built on `PopoverButton`'s `trigger="contextMenu"` mode, not this primitive. Confirm-delete candidate alongside `kit/DropdownMenu` once its 4 consumers move. |

### 2b. Dialogs — RULED (two tiers, both stay)

**Ruling (Pablo, already decided):** dialogs are two documented tiers —
`ConfirmationDialog` (product tier) and `kit/AlertDialog` (primitive tier) — both
stay, roles as documented in §1.

Adjacent, not covered by the ruling: `kit/Dialog.tsx` (6 importers) is a third,
lower-level raw-Radix-Dialog surface used directly by `IntegrationConnectDialog`,
`AddCustomIntegrationDialog`, `KeyboardShortcutsDialog`, `CloudRepoActionDialogHost`,
and (in `product-ui`) `CloudRepoPicker`/`AddRepoFlow`. This isn't one of the two
ruled tiers — it's a bypass of `ModalShell` for cases needing raw Dialog
composition (e.g. non-modal-shell layouts). Framed as an open decision in §4.

### 2c. Avatars — RULED (kit/Avatar deleted)

Already covered in §1 — `kit/Avatar.tsx` has 0 importers anywhere; delete is a
no-op removal, no migration needed.

### 2d. Password sign-in form — real duplicate, not yet ruled

| Path | Importers | Differences |
|---|---|---|
| `product-client/src/components/auth/PasswordSignInForm.tsx` | live (rendered by `LoginScreen`/`AuthShell`, the actual sign-in path) | Minimal email/password fields; error surfaced by parent screen; built directly on `ui/Input` + `ui/Button`. |
| `product-ui/src/auth/PasswordCredentialForm.tsx` | **0** | Fuller-featured form (submit/busy labels, `Label` component, `AUTH_PASSWORD_COPY` from `product-domain`) — but its entire call chain (`AuthStartPanel` → `AuthLayout` → …) is dead (§3). |
| **Recommendation** | Delete the `product-ui/src/auth/*` chain (8 files, all 0-importer, see §3) rather than "migrate" — `product-client`'s own `auth/` folder is the live implementation and was clearly built to replace it. Zero consumers to migrate. |

### 2e. Composer/automation control-pill — real near-duplicate, not yet ruled

| Path | Importers | Differences |
|---|---|---|
| `ui/src/primitives/ComposerControlButton.tsx` | 17 | Uses semantic tokens (`--color-muted-foreground`, `--color-foreground`) directly; supports `emphasizeLabel` two-tone label; label/detail typed as `ReactNode`. |
| `ui/src/primitives/PillControlButton.tsx` | 3 (`AutomationRunLocationSelector`, `AutomationAgentRunConfigPicker`, `AutomationEditorControls`) | Near-identical structural markup and prop surface (icon/label/detail/trailing/iconOnly) but: uses a *different* token namespace (`--color-x-control-*` vs `--color-muted-foreground`/`--color-foreground`), adds a `disclosure` auto-chevron, label/detail typed as plain `string`. A line-by-line diff (see recon) shows ~70% structural overlap — this reads as a second implementation of the same job with a different token binding, not a deliberate variant. |
| **Recommendation** | Migrate `PillControlButton`'s 3 automation consumers onto `ComposerControlButton` (it already supports the needed props: `icon`, `label`, `detail`, `trailing`, `iconOnly`; only `disclosure`'s auto-chevron would need to move to the call site as an explicit `trailing={<ChevronDown/>}`). ~3 files to touch. Flag: `ComposerControlButton` is itself in the foundation-coupling list (§5) — sequence this migration after the type/token pass lands on it, so the automations call sites don't get restyled twice. |

### 2f. Checkbox / Tooltip re-export indirection — cosmetic, no action needed

`ui/src/primitives/Checkbox.tsx` is a 1-line re-export of `kit/Checkbox.tsx`;
`ui/src/primitives/Tooltip.tsx` wraps `kit/Tooltip.tsx` with content-formatting
logic. Both are single implementations with two entry points, not real
duplicates — no migration needed, just noting so no one "fixes" this later
thinking it's an overlap.

### 2g. `SidebarNavItem` superseded by `SidebarNavRow` — no live consumers to migrate

| Path | Importers | Notes |
|---|---|---|
| `ui/src/layout/SidebarNavItem.tsx` | 0 | Older, plainer nav-row primitive (icon + active state only). |
| `ui/src/layout/SidebarNavRow.tsx` | 2 | Richer nav-row primitive (icon/label/status/shortcut slots, built on `SidebarRowSurface` + `ShortcutBadge`). Already the one in use. |
| **Recommendation** | Delete `SidebarNavItem` outright — zero consumers, nothing to migrate. |

### 2h. Settings page-header vs workflows page-header — two header systems, arguable

Covered as an open decision in §4 rather than a clean ruling, because unlike the
menu/dialog/avatar cases there's no obvious "wrong" one — see §4.

---

## 3. Dead (zero importers)

Every entry below was checked for (a) external cross-package imports via the
public subpath, and (b) internal same-package relative/alias imports. Both were
zero unless noted.

### `apps/packages/ui/src/`

| Path | Evidence |
|---|---|
| `kit/Avatar.tsx` | 0 external, 0 internal. **RULED deleted** (§2c). |
| `kit/ContextMenu.tsx` | 0 external, 0 internal. Right-click menus route through `PopoverButton`'s `contextMenu` trigger mode instead. |
| `kit/RadioGroup.tsx` | 0 external, 0 internal. |
| `kit/Separator.tsx` | 0 external, 0 internal. |
| `kit/Table.tsx` | 0 external, 0 internal. The one real table (`ModelTable`) hand-rolls `<table>` instead. |
| `layout/AppShell.tsx` | 0 external, 0 internal (a name-collision grep against `icons/app-shell.tsx`'s icon exports was ruled out — different files). |
| `layout/EnvironmentLayout.tsx` | 0 external, 0 internal. |
| `layout/ListSurface.tsx` | 0 external, 0 internal. |
| `layout/SectionHeader.tsx` | 0 external, 0 internal. |
| `layout/SidebarFrame.tsx` | 0 external, 0 internal. |
| `layout/SidebarNavItem.tsx` | 0 external, 0 internal. Superseded by `SidebarNavRow` (§2g). |
| `layout/SizedPanel.tsx` | 0 external, 0 internal. |
| `layout/EmptyState.tsx` | 0 external, 0 internal. Both real consumers of "empty state" (`SettingsEmptyState`, `GitReviewEmptyState`) are separate scope-specific implementations that never routed through this. |
| `primitives/CollapsibleSummaryRow.tsx` | 0 external, 0 internal. |
| `primitives/SelectionRow.tsx` | 0 external, 0 internal. |
| `primitives/Tabs.tsx` | 0 external, 0 internal. Pill-style tab group; the live tabs look (`SettingsScopeTabs`) is a separate `product-ui` component. |
| `primitives/Toggle.tsx` | 0 external, 0 internal. Pressed-button toggle (toolbar bold/italic style) — no caller needs this job today. |
| `primitives/GridTile.tsx` | 1 nominal importer (`product-ui/settings/ModelConfigGrid.tsx`) but **transitively dead**: `ModelConfigGrid` itself has 0 importers (below). |

Not dead, flagged to avoid false "delete" calls:
- `kit/Popover.tsx` shows 0 *external* subpath importers but is consumed
  internally by `primitives/PopoverButton.tsx` via a relative import
  (`from "../kit/Popover"`) — it's the load-bearing Radix layer under the
  sanctioned menu system, not dead code.
- `lib/utils.ts` (the `cn()` helper) shows 0 external importers but is used by
  13 files inside `ui/src/kit/*` and `primitives/ModalShell.tsx` via relative
  imports — internal utility, not dead.

### `apps/packages/product-ui/src/`

| Path | Evidence |
|---|---|
| `account/AccountIdentityCard.tsx` | 0 external, 0 internal. |
| `account/ConnectedProviderRow.tsx` | 0 external, 0 internal. |
| `auth/AuthLayout.tsx`, `AuthStartPanel.tsx`, `ConnectGitHubPanel.tsx`, `ConnectGitHubRequiredPanel.tsx`, `GoogleGlyph.tsx`, `LegalLinks.tsx`, `PasswordCredentialForm.tsx` | 0 external. `AuthLayout` has 2 internal consumers (`ConnectGitHubRequiredPanel`, `AuthStartPanel`) but that whole chain is unreachable from any live app entry point — `product-client` built its own `components/auth/*` (`LoginScreen`, `AuthShell`, `PasswordSignInForm`) instead. This is a dead subtree, not 7 independently dead leaves — see §2d. |
| `automations/AutomationCreatePanel.tsx` | 0 external, 0 internal. Doc-comments elsewhere ("automations/AutomationSurface") don't reference it. |
| `brand/ProliferateMark.tsx` | 0 external, 0 internal (superseded by `ProliferateLivingMark`, which has 3 importers). |
| `chat/ChatPreviewSurface.tsx` | 0 external. 1 internal user (`ClaimBanner.tsx`), but `ClaimBanner` itself is also 0-external — dead pair. |
| `chat/CloudChatComposer.tsx`, `chat/CloudChatTranscript.tsx` | 0 external. Both have internal users (`CloudChatSurface`, `NewChatSurface`, `AutomationCreatePanel`) that are themselves unreachable — `NewChatSurface` (below) and `AutomationCreatePanel` (above) are dead; `CloudChatSurface` has only 1 importer (`CloudRepoPicker`-adjacent) worth spot-checking before deletion (not zero, so kept in §1, but its main downstream `NewChatSurface` is dead — recommend re-verifying this whole `chat/Cloud*` composer/transcript family together rather than leaf-by-leaf). |
| `code/VirtualizedCodeContent.tsx` | 0 external, 0 internal. |
| `new-chat/NewChatSurface.tsx` | 0 external, 0 internal. |
| `settings/InstallGate.tsx` | 0 external, 0 internal. Superseded by `product-client/components/settings/panes/agents/harness/HarnessInstallGate.tsx` (a from-scratch reimplementation, not built on this). |
| `settings/ModelConfigGrid.tsx` | 0 external, 0 internal. A code comment in the sibling `ModelTable.tsx` claims "`ModelConfigGrid` still backs the org agent-policy grid" — that comment is stale; grep confirms zero live callers. Its own dependency `primitives/GridTile.tsx` is transitively dead as a result. |
| `settings/SettingsShell.tsx` | 0 external, 0 internal. |
| `sidebar/ProductSidebar.tsx` | 0 external, 0 internal (though its own child `ProductSidebarFooter` is consumed by it — dead pair). |
| `workspaces/CloudWorkspaceList.tsx`, `WorkspaceRow.tsx`, `WorkspacesSurface.tsx` | 0 external, 0 internal cross-file (each other's only consumer is also dead). |

Not dead, flagged to avoid false "delete" calls:
- `chat/transcript/MarkdownContentSearchMarks.tsx` shows 0 external subpath
  importers but is consumed internally by `chat/transcript/MarkdownBody.tsx`
  (`import { markSearchChildren } from "./MarkdownContentSearchMarks"`) — this
  is the markdown-tree content-search highlighter, load-bearing, not dead. (It
  is a *different* job from `product-client`'s `ContentSearchMarks.tsx`, which
  highlights plain-text diff/file content — not a duplicate, just similarly
  named.)

### `apps/packages/product-surfaces/src/` — orphaned environments/support scaffolding

Verified against this tree directly, per the task's flag:

| Path | Evidence |
|---|---|
| `settings/CloudEnvironmentsSettingsSurface.tsx` | 0 external, 0 internal (only its own `.test.tsx` references it). The live repo-environments UI is built directly in `product-client/src/components/settings/panes/repo/RepoEnvironmentPane.tsx` (`EnvironmentCloud`/`EnvironmentLocal` inline), which does not import this surface. |
| `settings/cloud-environments/AddCloudEnvironmentDialogController.tsx`, `CloudEnvironmentDetail.tsx` | Both are internal-only dependents of `CloudEnvironmentsSettingsSurface` above — dead as a unit once the surface goes. `use-add-cloud-environment.ts`/`use-cloud-environment-draft.ts` (the hooks) are *not* dead — they're re-imported directly by `product-client` (`AddRepoFlowHost.tsx`, `use-cloud-repo-environment-editor.ts`) independent of the surface component, so keep the hooks, delete the surface + controller + detail component. |
| `support/CloudSupportSurface.tsx` | 0 external, 0 internal (only its own `.test.tsx`). The live support UI is `product-client/src/components/support/SupportModalHost.tsx` + `SendFeedbackModal.tsx`/`SubmitPromptModal.tsx`, unrelated to this surface. Its dependency `product-ui/support/SupportSurface.tsx` has exactly 1 importer — this dead file — so `SupportSurface` is transitively dead too if `CloudSupportSurface` is removed. |

The task also asked to check `product-ui/environments/CloudEnvironmentList.tsx` and
`CloudEnvironmentConfigSection.tsx` — **these are not dead**: both are imported by
`CloudEnvironmentsSettingsSurface.tsx` and its `CloudEnvironmentDetail.tsx` child.
They only die *if* the whole `CloudEnvironmentsSettingsSurface` orphan branch is
removed — bundled as one deletion unit, not independently dead today.

### `apps/packages/product-client/src/components/`

No fully-dead reusable component was found in this tree (everything either has a
live internal `#product/*`/relative-import consumer, or is a one-off page
composition excluded from scope per the task's instructions). The closest
candidates were the six pure re-export barrels below — not dead, just
redundant indirection:

- `components/feedback/ThinkingText.tsx`, `Skeleton.tsx`
- `components/session-controls/SessionControlIcon.tsx`
- `components/workspace/chat/transcript/AssistantMessage.tsx`, `ProposedPlanCard.tsx`, `CopyMessageButton.tsx`
- `components/workspace/shell/sidebar/SidebarShowToggleRow.tsx`

Each is a 1–6 line `export { X } from "@proliferate/ui/..."` / `"@proliferate/product-ui/..."` file with no logic of its own — likely left over from a pre-`#product/*`-alias era. Not a culling target (deleting them means updating each of their few internal importers to reach across the package boundary directly), but worth flagging as tidy-up debt separate from the cull.

---

## 4. Open decisions for Pablo

**D1 — `kit/Dialog.tsx` (6 importers): fold into `ModalShell`, or keep as a third tier?**
`ModalShell` (15 importers) is the general-purpose custom-dialog shell; `kit/Dialog.tsx` is the raw Radix wrapper still used directly by `IntegrationConnectDialog`, `AddCustomIntegrationDialog`, `KeyboardShortcutsDialog`, `CloudRepoActionDialogHost`, and `product-ui`'s `CloudRepoPicker`/`AddRepoFlow`. Either:
(a) migrate these 6 onto `ModalShell` (consistent with the two-ruled-tier model, removes a third dialog surface) — cost: 6 files, some of which (`KeyboardShortcutsDialog`) may need layout flexibility `ModalShell` doesn't offer today; or
(b) formally document `kit/Dialog` as a third "raw primitive" tier alongside the two ruled tiers, for cases where `ModalShell`'s fixed chrome doesn't fit. Trade-off: (a) is cleaner but risks forcing content into a shell not built for it; (b) is honest about existing variance but permanently keeps 3 dialog surfaces alive.

**D2 — No sanctioned user-avatar component: build one, or is ad-hoc `<img>` fine?**
`OrganizationAvatar` is the one true reusable avatar (org logo + initials fallback, ruled sanctioned in §1). Person/user avatars are rendered as raw `<img src={avatarUrl}>` with no fallback-initials treatment in at least 3 places (`ProductSidebarAccountFooter`, `SidebarAccountFooter`, `AccountPane`). Either extract a `UserAvatar` sibling to `OrganizationAvatar` (small, ~1 file, 3 call sites to touch) or decide this is intentionally not worth abstracting yet. Not urgent, but worth a decision before the cull locks the "avatar" job as single-component.

**D3 — `product-ui/layout/ProductPageShell` + `PageHeader`/`PageContentFrame` (2 importers) vs `product-ui/settings/SettingsPageHeader` (25 importers): one page-header system or two?**
The workflows-access surfaces (`WorkflowDefinitionsAccessScreen`, `WorkflowResourceState`) use a completely separate page-header/shell stack from the other 25 Settings-scope panes. Either this is a deliberate "non-settings product page" visual tier that should stay separate (workflows access screens aren't inside the Settings shell), or it's simply the 2 remaining holdouts that never got migrated to `SettingsPageHeader` when Settings consolidated. Needs a look at whether the workflows-access screens are visually/structurally inside the Settings shell chrome or a standalone page — if the former, migrate; if the latter, keep as a second documented tier like the dialog ruling.

**D4 — `chat/CloudChatComposer.tsx`/`CloudChatTranscript.tsx`/`CloudChatSurface.tsx` family (product-ui): last remnant of a dead composer generation, likely deletable — confirm scope before pulling the trigger.**
`CloudChatSurface`'s sole importer is `product-client/src/components/playground/loading/PlaygroundLoadingStates.tsx` — a playground fixture, not a production surface. Its siblings `CloudChatComposer`/`CloudChatTranscript` are each consumed only by things that are themselves dead (`NewChatSurface`, `AutomationCreatePanel`) or by `CloudChatSurface` itself. So the entire family is reachable only from playground code, while the real chat surface lives in `product-client/src/components/workspace/chat/*`. This is the same pattern as the dead auth-panel chain in §2d/§3, just one hop further from "zero importers" because a playground fixture keeps it technically alive. Decision: either (a) delete the whole family and repoint `PlaygroundLoadingStates.tsx` at the real `workspace/chat/*` loading surface (small, ~1 file to touch), or (b) if the playground intentionally exercises the old surface for some regression-coverage reason, say so explicitly and keep it — but that reasoning isn't evident from the code today.

---

## 5. Foundation-coupling notes

These sanctioned (§1) components are heavy consumers of the type/token system
(semantic CSS vars like `--color-*`, the `text-ui`/`text-title` type scale,
`--radius`) and will be visually touched by the upcoming foundations/type pass.
Any culling migration that lands *on* these components should be sequenced
**after** the foundations pass, not before — otherwise the migrated call sites
get restyled twice.

| Component | Token surface | Why it matters for sequencing |
|---|---|---|
| `ui/src/primitives/Button.tsx` | 8 token/type-scale hits; every variant/size combination is expressed in tokens | Every menu/dialog/composer migration in §2 routes through `Button` underneath (`PopoverButton`'s trigger, `ComposerControlButton`, `ModalShell`'s actions) — a token change here ripples everywhere. |
| `ui/src/primitives/PopoverMenuItem.tsx` | 7 token hits | The §2a `DropdownMenu → PopoverButton/PopoverMenuItem` migration (4 files) should land after this is restyled, so the migrated menu rows don't need a second pass. |
| `ui/src/primitives/ModalShell.tsx` | 7 token hits | The §4-D1 `kit/Dialog → ModalShell` migration (if taken) should wait for this. |
| `product-ui/src/settings/SettingsRow.tsx` | 5 token hits | High-traffic (15 importers) — any Settings-scope migration work should follow the foundations pass on this file. |
| `ui/src/primitives/ConfirmationDialog.tsx` | 3 token hits | Product-tier dialog (ruled, §2b) — stable role, but visual surface will shift. |
| `ui/src/primitives/Badge.tsx` | 3 token hits | 31 importers; any badge-adjacent cleanup (e.g. §1's `PrStatusBadge`) should wait. |
| `product-ui/src/settings/SettingsPageHeader.tsx` | 3 token hits | 25 importers — the §4-D3 decision on folding in the workflows page-header family should wait until this is restyled, so the migrated screens land on the final look once. |
| `product-ui/src/settings/SettingsSection.tsx` | 2 token hits | 28 importers, same sequencing logic as `SettingsRow`. |
| `ui/src/primitives/Input.tsx`, `Label.tsx` | 1 token hit each (but 54 / 27 importers) | Lower own-token-density but extremely high fan-out — small foundations edits here have the widest blast radius of anything in the catalog. |

Components with **zero** token/type-scale hits in the components above
(`PopoverButton.tsx`, `kit/Tooltip.tsx`) are structurally uncoupled from the
foundations pass — they compose other primitives for behavior/positioning and
inherit styling from what they render, so they're safe to migrate consumers
onto *before* the foundations pass lands, if that unblocks the §2a/§2e work
sooner.

---

## Addendum — package composition direction (provisional ruling, Pablo 2026-07-25)

Read the catalog above with this end state in mind. Post web/desktop unification,
the DOM packages have exactly one real consumer: `product-client` (verified — the
web/desktop shells import zero symbols from `ui`, `product-ui`, or
`product-surfaces`; their package.json entries are stale). The composition
collapses **6 packages → 3**:

- **`design`** — stays a package (consumed by web, desktop, and mobile).
- **`product-domain`** — stays a package (the mobile sharing point; the no-DOM
  constraint is load-bearing).
- **`product-client`** — absorbs `ui`, `product-ui`, and `product-surfaces`.

**The library model (RULED, Pablo 2026-07-25).** Inside the merged package there
is ONE component-library space — the only place visual components may live —
organized by **component role, never by feature area**:

- `library/primitives/` — single-purpose visual atoms (Button, Input, Label,
  Badge, Switch, Tooltip, Popover, menu items…)
- `library/patterns/` — reusable compositions (ModalShell, ConfirmationDialog,
  EmptyState, Table, Tabs, PageHeader, SettingsRow/Section, status cards,
  composer controls…). Naming describes intent, not address — `SettingsRow`
  lives here, not in a settings folder.

Two tiers only, both purely presentational (data in, callbacks out) — there is
**no `surfaces/` tier** (RULED direction, Pablo 2026-07-25). The census showed
ex-product-surfaces is almost entirely single-call-site page bodies (Billing,
SSO, Workflows surfaces each have exactly one consumer): those dissolve into
ordinary feature code that composes library patterns + access hooks. The one
genuine multi-spot connected block, `CloudSecretsSettingsSurface` (org /
personal / repo panes), splits into a presentational secrets pattern in the
library + a shared access hook — **OPEN (D5)**: confirm the split vs keeping it
as a single connected component. Reused cloud-environment hooks stay in the
hooks/access world; they were never library citizens.

(`library/` is a placeholder name for the protected subtree, finalized at
ruling time.) **Feature code (pages/panes/screens) is composition only**: it
assembles library components and wires state; it never defines styled
components or carries its own visual vocabulary. Needing a new component means
designing it, adding it to the library with a catalog entry, then using it.
This catalog is therefore the library's index — the closed set of explicitly
designed components — parallel to `tokens.ts` as the closed set of values.

Enforcement: the boundary gate generalizes — Radix imports, styled-primitive
definitions, and heavy visual vocabulary are only legal inside the library
space; feature folders that grow them fail CI (natural home: existing Repo
shape checks + the appearance-scaling gate). The extraction cuts BOTH ways:
reused styled components currently buried in product-client feature folders
move INTO the library, not just ui/product-ui components down.

Consequences for this catalog: the ui-vs-product-ui duplicate seam (§2)
disappears as a *structural* cause — the sanctioned set becomes one namespace;
the "which package does the survivor live in" question in each §2/§4 entry is
moot (answer: the library, at its taxonomy path above).

Sequencing (RULED, Pablo 2026-07-25): the 3-package end state is blessed as
direction, but the full merge is **not** part of this migration program — no
big-bang composition PR. Convergence is opportunistic: the culling PR moves the
components it touches onto their final-taxonomy path (imports fixed) **where
the current dependency direction allows** — a component can move into
`product-client` only if all its importers already live there; anything still
consumed by `product-ui`/`product-surfaces` stays put for now with its final
home noted. Remaining absorption is a mechanical follow-up after this program.

### Movability: which survivors can reach their final path in the culling PR

**12 movable now / 45 blocked / 57 analyzed.** All MOVABLE NOW verdicts were re-grepped a second time (both the public-subpath external form and the same-package relative-import form) across `ui`, `product-ui`, and `product-surfaces` before finalizing — zero importers in all three, confirmed. No component with any external `ui`/`product-ui`/`product-surfaces` importer, or any internal same-package consumer, was miscounted as movable.

Final-home taxonomy uses the two-tier library model (no `surfaces` tier): `product-client/src/library/primitives/<Name>` for single-purpose visual atoms, `product-client/src/library/patterns/<Name>` for reusable multi-part compositions. Ex-`product-surfaces` connected surfaces are out of the library entirely — most dissolve into feature code; `CloudSecretsSettingsSurface` is flagged OPEN.

| Component | Current path | Importers (ui / p-ui / p-surf / p-client) | Verdict | Final home |
|---|---|---|---|---|
| `kit/AlertDialog` | `ui/src/kit/AlertDialog.tsx` | 0 / 0 / 0 / 2 | **MOVABLE NOW** | `product-client/src/library/patterns/AlertDialog` |
| `LevelBarsButton` | `ui/src/primitives/LevelBarsButton.tsx` | 0 / 0 / 0 / 1 | **MOVABLE NOW** | `product-client/src/library/primitives/LevelBarsButton` |
| `ModelTable` | `product-ui/src/settings/ModelTable.tsx` | 0 / 0 / 0 / 1 | **MOVABLE NOW** | `product-client/src/library/patterns/ModelTable` |
| `PaneIconButton` | `ui/src/layout/PaneIconButton.tsx` | 0 / 0 / 0 / 4 | **MOVABLE NOW** | `product-client/src/library/primitives/PaneIconButton` |
| `PaneOptionsMenuItem` | `ui/src/layout/PaneOptionsMenuItem.tsx` | 0 / 0 / 0 / 3 | **MOVABLE NOW** | `product-client/src/library/patterns/PaneOptionsMenuItem` |
| `PillControlButton` | `ui/src/primitives/PillControlButton.tsx` | 0 / 0 / 0 / 3 | **MOVABLE NOW** | `product-client/src/library/patterns/PillControlButton` (pending §2e merge into `ComposerControlButton`) |
| `ProgressBar` | `ui/src/primitives/ProgressBar.tsx` | 0 / 0 / 0 / 3 | **MOVABLE NOW** | `product-client/src/library/primitives/ProgressBar` |
| `RadioCardGroup` | `ui/src/primitives/RadioCardGroup.tsx` | 0 / 0 / 0 / 1 | **MOVABLE NOW** | `product-client/src/library/primitives/RadioCardGroup` |
| `SettingsSaveFooter` | `product-ui/src/settings/SettingsSaveFooter.tsx` | 0 / 0 / 0 / 2 | **MOVABLE NOW** | `product-client/src/library/patterns/SettingsSaveFooter` |
| `SettingsScopeTabs` | `product-ui/src/settings/SettingsScopeTabs.tsx` | 0 / 0 / 0 / 1 | **MOVABLE NOW** | `product-client/src/library/patterns/SettingsScopeTabs` |
| `kit/Sonner` | `ui/src/kit/Sonner.tsx` | 0 / 0 / 0 / 4 | **MOVABLE NOW** | `product-client/src/library/patterns/Sonner` |
| `command-palette-icons` | `ui/src/command-palette-icons.tsx` | 0 / 0 / 0 / 1 | **MOVABLE NOW** | `product-client/src/library/primitives/command-palette-icons` |
| `Button` | `ui/src/primitives/Button.tsx` | 8 / 59 / 4 / 177 | BLOCKED (ui, product-ui, product-surfaces) | `library/primitives/Button` |
| `Checkbox` (kit) | `ui/src/kit/Checkbox.tsx` | 1 / 1 / 0 / 0 | BLOCKED (ui, product-ui) | `library/primitives/Checkbox` |
| `Checkbox` (primitives re-export) | `ui/src/primitives/Checkbox.tsx` | 0 / 2 / 0 / 8 | BLOCKED (product-ui) | `library/primitives/Checkbox` |
| `ComposerActionButton` | `ui/src/primitives/ComposerActionButton.tsx` | 0 / 1 / 0 / 1 | BLOCKED (product-ui) | `library/patterns/ComposerActionButton` |
| `ComposerControlButton` | `ui/src/primitives/ComposerControlButton.tsx` | 1 / 4 / 0 / 13 | BLOCKED (ui, product-ui) | `library/patterns/ComposerControlButton` |
| `ComposerTextarea` | `ui/src/primitives/ComposerTextarea.tsx` | 0 / 1 / 0 / 3 | BLOCKED (product-ui) | `library/patterns/ComposerTextarea` |
| `ComposerTextareaFrame` | `ui/src/primitives/ComposerTextareaFrame.tsx` | 0 / 1 / 0 / 5 | BLOCKED (product-ui) | `library/patterns/ComposerTextareaFrame` |
| `ConfirmationDialog` | `ui/src/primitives/ConfirmationDialog.tsx` | 0 / 3 / 0 / 11 | BLOCKED (product-ui) | `library/patterns/ConfirmationDialog` |
| `kit/Dialog` | `ui/src/kit/Dialog.tsx` | 1 / 2 / 0 / 4 | BLOCKED (ui, product-ui) | `library/patterns/Dialog` |
| `EnvironmentSearchSelect` | `ui/src/primitives/EnvironmentSearchSelect.tsx` | 0 / 1 / 0 / 2 | BLOCKED (product-ui) | `library/patterns/EnvironmentSearchSelect` |
| `IconButton` | `ui/src/primitives/IconButton.tsx` | 1 / 4 / 0 / 17 | BLOCKED (ui, product-ui) | `library/primitives/IconButton` |
| `Input` | `ui/src/primitives/Input.tsx` | 1 / 14 / 0 / 40 | BLOCKED (ui, product-ui) | `library/primitives/Input` |
| `Label` | `ui/src/primitives/Label.tsx` | 0 / 9 / 0 / 18 | BLOCKED (product-ui) | `library/primitives/Label` |
| `ModalShell` | `ui/src/primitives/ModalShell.tsx` | 1 / 2 / 0 / 13 | BLOCKED (ui, product-ui) | `library/patterns/ModalShell` |
| `layout/PageContentFrame` | `ui/src/layout/PageContentFrame.tsx` | 0 / 1 / 0 / 0 | BLOCKED (product-ui) | `library/patterns/PageContentFrame` (internal to `ProductPageShell`) |
| `layout/PageHeader` | `ui/src/layout/PageHeader.tsx` | 0 / 1 / 0 / 0 | BLOCKED (product-ui) | `library/patterns/PageHeader` (internal to `ProductPageShell`) |
| `PickerPopoverContent` | `ui/src/primitives/PickerPopoverContent.tsx` | 1 / 0 / 0 / 3 | BLOCKED (ui — internal to `EnvironmentSearchSelect`) | `library/patterns/PickerPopoverContent` |
| `PopoverButton` | `ui/src/primitives/PopoverButton.tsx` | 2 / 4 / 0 / 47 | BLOCKED (ui, product-ui) | `library/primitives/PopoverButton` |
| `PopoverMenuItem` | `ui/src/primitives/PopoverMenuItem.tsx` | 2 / 5 / 0 / 28 | BLOCKED (ui, product-ui) | `library/primitives/PopoverMenuItem` |
| `PrStatusBadge` | `product-ui/src/workspaces/PrStatusBadge.tsx` | 0 / 2 / 0 / 2 | BLOCKED (product-ui) | `library/patterns/PrStatusBadge` |
| `ProductPageShell` | `product-ui/src/layout/ProductPageShell.tsx` | 0 / 6 / 1 / 1 | BLOCKED (product-ui, product-surfaces) | `library/patterns/ProductPageShell` |
| `SegmentedControl` | `ui/src/primitives/SegmentedControl.tsx` | 0 / 1 / 0 / 6 | BLOCKED (product-ui) | `library/primitives/SegmentedControl` |
| `Select` | `ui/src/primitives/Select.tsx` | 0 / 6 / 0 / 8 | BLOCKED (product-ui) | `library/primitives/Select` |
| `SettingsEmptyState` | `product-ui/src/settings/SettingsEmptyState.tsx` | 0 / 2 / 0 / 16 | BLOCKED (product-ui) | `library/patterns/SettingsEmptyState` |
| `SettingsEyebrow` | `product-ui/src/settings/SettingsEyebrow.tsx` | 0 / 1 / 0 / 4 | BLOCKED (product-ui) | `library/patterns/SettingsEyebrow` |
| `SettingsMenu` | `ui/src/primitives/SettingsMenu.tsx` | 0 / 1 / 0 / 2 | BLOCKED (product-ui) | `library/patterns/SettingsMenu` |
| `SettingsPageHeader` | `product-ui/src/settings/SettingsPageHeader.tsx` | 0 / 2 / 2 / 23 | BLOCKED (product-ui, product-surfaces) | `library/patterns/SettingsPageHeader` |
| `SettingsRow` | `product-ui/src/settings/SettingsRow.tsx` | 0 / 5 / 3 / 12 | BLOCKED (product-ui, product-surfaces) | `library/patterns/SettingsRow` |
| `SettingsSection` | `product-ui/src/settings/SettingsSection.tsx` | 0 / 7 / 3 / 25 | BLOCKED (product-ui, product-surfaces) | `library/patterns/SettingsSection` |
| `ShortcutBadge` | `ui/src/layout/ShortcutBadge.tsx` | 1 / 1 / 0 / 7 | BLOCKED (ui, product-ui) | `library/patterns/ShortcutBadge` |
| `SidebarActionButton` | `ui/src/layout/SidebarActionButton.tsx` | 0 / 1 / 0 / 4 | BLOCKED (product-ui) | `library/patterns/SidebarActionButton` |
| `SidebarNavRow` | `ui/src/layout/SidebarNavRow.tsx` | 0 / 1 / 0 / 1 | BLOCKED (product-ui) | `library/patterns/SidebarNavRow` |
| `SidebarRowSurface` | `ui/src/layout/SidebarRowSurface.tsx` | 1 / 3 / 0 / 3 | BLOCKED (ui, product-ui) | `library/patterns/SidebarRowSurface` |
| `AutoHideScrollArea` | `ui/src/layout/AutoHideScrollArea.tsx` | 0 / 4 / 0 / 14 | BLOCKED (product-ui) | `library/patterns/AutoHideScrollArea` |
| `Badge` | `ui/src/primitives/Badge.tsx` | 0 / 17 / 1 / 13 | BLOCKED (product-ui, product-surfaces) | `library/primitives/Badge` |
| `Skeleton` | `ui/src/primitives/Skeleton.tsx` | 0 / 4 / 2 / 1 | BLOCKED (product-ui, product-surfaces) | `library/primitives/Skeleton` |
| `Spinner` | `ui/src/primitives/Spinner.tsx` | 3 / 1 / 0 / 1 | BLOCKED (ui, product-ui) | `library/primitives/Spinner` |
| `Switch` | `ui/src/primitives/Switch.tsx` | 0 / 2 / 1 / 8 | BLOCKED (product-ui, product-surfaces) | `library/primitives/Switch` |
| `Textarea` | `ui/src/primitives/Textarea.tsx` | 1 / 9 / 0 / 10 | BLOCKED (ui, product-ui) | `library/primitives/Textarea` |
| `ThinkingText` | `ui/src/primitives/ThinkingText.tsx` | 0 / 1 / 0 / 1 | BLOCKED (product-ui) | `library/patterns/ThinkingText` |
| `kit/Tooltip` | `ui/src/kit/Tooltip.tsx` | 1 / 0 / 0 / 1 | BLOCKED (ui — internal to `primitives/Tooltip`) | `library/primitives/Tooltip` (merges with wrapper) |
| `Tooltip` (primitives) | `ui/src/primitives/Tooltip.tsx` | 0 / 3 / 0 / 13 | BLOCKED (product-ui) | `library/primitives/Tooltip` |
| `icons` (barrel + detail modules) | `ui/src/icons.tsx` | 0 / 18 / 2 / 177 | BLOCKED (product-ui, product-surfaces) | `library/primitives/icons` |
| `proliferate-icons` | `ui/src/proliferate-icons.tsx` | 1 / 1 / 0 / 5 | BLOCKED (ui, product-ui) | `library/primitives/proliferate-icons` |
| `provider-icons` | `ui/src/provider-icons.tsx` | 0 / 1 / 0 / 8 | BLOCKED (product-ui) | `library/primitives/provider-icons` |

#### Judgment calls / items not fully resolvable

- **`kit/AlertDialog`, `kit/Sonner`, `kit/Dialog`, `kit/Tooltip`, `kit/Checkbox` primitives/patterns split** — these are the raw Radix wrapper layer. Movable ones (`AlertDialog`, `Sonner`) were classified as `patterns` rather than `primitives` because they're documented as tiered/composite systems in the catalog (two-tier dialog model, toast system funnel), not bare single-purpose atoms — but a reasonable alternative reading puts bare Radix wrappers in `primitives` regardless of tier. Flag for ruling confirmation.
- **`PillControlButton`** is movable by import-graph rules today, but per catalog §2e it's slated to be migrated onto `ComposerControlButton` and deleted — moving it into the library now is technically correct but may be wasted motion if that migration lands first. Sequencing call, not a grep-accuracy issue.
- **`command-palette-icons`** and **`proliferate-icons`/`provider-icons`/`icons`** are barrel/icon-set modules, not components in the traditional sense. The single movable one (`command-palette-icons`) was mapped to `library/primitives/` by analogy with the other icon sets, but "icon set" doesn't cleanly fit the atom/composition primitives-vs-patterns distinction — flag if a separate `icons/` tier is intended.
- **`layout/PageHeader` and `layout/PageContentFrame`** have exactly one importer each (`ProductPageShell`, itself BLOCKED by product-ui/product-surfaces) — classic internal-only case, resolved to BLOCKED via their sole importer's chain.
- **`PickerPopoverContent`** and **`kit/Tooltip`** are each blocked solely by one *internal* `ui`-package consumer (`EnvironmentSearchSelect`, `primitives/Tooltip` respectively) rather than by `product-ui`/`product-surfaces` — technically BLOCKED per the one-way dependency rule, but since both blockers are themselves slated to move together, these could be reclassified as movable-as-a-unit with their blocker once that unit is ready.
- **Ex-`product-surfaces` connected surfaces** (`BillingSettingsSurface` + `BillingManagementCards`/`BillingUsageUnitsSection`/`BillingOwnerController`, `CloudOrganizationSsoSettingsSurface`, `WorkflowDefinitionsSurface`, `WorkflowRunsSurface`, `CloudEnvironmentsSettingsSurface` + its controller/detail, `CloudSupportSurface`) are out of scope for this table by design: per the two-tier ruling their final home is feature code, not the library.
- **`CloudSecretsSettingsSurface`** (3 call sites) has no row above — its OPEN split decision (presentational secrets pattern in `library/patterns/` + shared access hook) is tracked as D5 in the addendum above.
- **`use-add-cloud-environment` / `use-cloud-environment-draft` hooks** — out of scope for this component table; they belong to hooks/access, not the library.
