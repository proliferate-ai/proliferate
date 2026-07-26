# Component Library

The single entry point for the component library: the tier model that
organizes every shared Desktop/Web UI component, the governance rule that
keeps feature code from inventing new visual vocabulary outside it, and the
sanctioned index — the closed set of components the library actually ships
today, with their current paths.

**Owns:** the library's tier model and placement rule (role, not feature
area), the feature-code composition boundary and how it is enforced, the
sanctioned index of every library component, and how a component graduates
into the library.

**Does not own:** token values and the ruled visual look — type ramp, control
weight, composer/transcript anatomy — which belong to
[design-system.md](design-system.md); package-level dependency direction
between `design`/`ui`/`product-domain`/`product-ui`/`product-surfaces`/
`product-client` (the six-package boundary), which belongs to
[structures/frontend/packages/README.md](../../structures/frontend/packages/README.md);
and per-surface product behavior, which belongs to the owning
[systems/product/**](../../systems/README.md) document.

## Where The Library Lives

```text
apps/packages/ui/src/
├── primitives/    raw Radix/vendor wrapper families + single-purpose visual atoms
├── patterns/      opinionated compositions built from primitives + tokens
├── icons/         icon sets: a general barrel plus command-palette/brand/provider glyph modules
├── lib/, utils/, overlays/
│                  supporting infrastructure (cn() class joiner, tw-merge,
│                  search/scroll helpers, native-overlay-stack registration) —
│                  not components, no catalog rows below

apps/packages/product-ui/src/patterns/
                   domain-aware patterns: same composition rule as ui/src/patterns,
                   but this tier may import product-domain view models/vocabulary
```

`apps/packages/ui/src` has no other top-level entries; the six above are the
complete list enforced by `UI_SRC_ALLOWED_TOP_LEVEL_ENTRIES` in
[check_frontend_boundaries.py](../../../../scripts/check_frontend_boundaries.py).

## The Library Model

Three tiers inside `ui/src`, organized by **component role, never by feature
area** — a component's name describes what it does, not where it is used:

- **`primitives/`** — the base tier. Holds both the raw Radix (and other
  vendor) wrapper families — `Dialog`, `AlertDialog`, `Popover`,
  `DropdownMenu`, `checkbox-primitive`, `tooltip-primitive`, `Command`,
  `Sonner` — and single-purpose visual atoms that don't compose another
  primitive: `Button`, `Input`, `Label`, `Badge`, `Switch`, `Select`,
  `Textarea`, `IconButton`, `Spinner`, `Skeleton`, and similar. Radix wrappers
  are vendored, shadcn-derived source that the repo owns outright, styled to
  `design` tokens; they are not a separate tier from the plain atoms because
  both are one-level building blocks with no other library component beneath
  them.
- **`patterns/`** — opinionated reusable compositions one level up from
  primitives: `ModalShell` (built on `Dialog`), `ConfirmationDialog` (built on
  `ModalShell` + `Button`), `CommandPalette` (built directly on `cmdk`, not on
  the `Command` primitive — see the `Command` row below), `EmptyState`,
  `SidebarNavRow`, composer controls, and similar. A pattern is named for the
  job it does (`ListRow`, `PageHeader`), never for the feature that first
  needed it.
- **`icons/`** — icon sets: a general glyph barrel plus named sets scoped to a
  specific surface (command palette) or brand (Proliferate mark, auth/model
  provider glyphs). Icon sets are barrels of glyphs, not components in the
  atom/composition sense, so they get their own tier rather than living inside
  `primitives/` or `patterns/`.

A fourth tier lives in a different package because of an import-direction
constraint, not a different role:

- **`product-ui/src/patterns/`** — domain-aware patterns. Same composition
  rule as `ui/src/patterns/` (built from primitives/patterns + tokens), but
  this tier is allowed to import `product-domain` view models and vocabulary,
  which `ui/src/patterns/` must not (per the package boundary in
  [packages/README.md](../../structures/frontend/packages/README.md)). The
  settings family (`SettingsRow`, `SettingsSection`, `SettingsPageHeader`,
  and siblings), `PrStatusBadge`, `ProductPageShell`, and the `secrets/`
  sub-tree live here for that reason, not because they belong to a
  "settings" or "secrets" feature folder.

There is no fourth content tier inside `ui/src` (no `surfaces/`, no
feature-keyed folder): a component's tier is always primitives, patterns, or
icons, decided by role.

## Governance Rule

Feature code (pages, panes, screens under `product-client`, `product-ui`
outside `patterns/`, `product-surfaces`, `apps/desktop`, `apps/web`) composes
library components and `design` tokens. It does not invent new visual
vocabulary:

- **No raw Radix imports outside the library.** Every `@radix-ui/*` import
  must resolve to a file under `ui/src/primitives/**` or `ui/src/patterns/**`.
  Enforced by `RADIX_IMPORT_OUTSIDE_UI_COMPONENT_LIBRARY` in
  [check_frontend_boundaries.py](../../../../scripts/check_frontend_boundaries.py),
  scanned across every frontend package and app.
- **No hardcoded style values.** Colors, spacing, radii, shadows, and motion
  come from `design` tokens through library components, never as arbitrary
  Tailwind brackets or raw hex/duration values at a feature callsite. Enforced
  by the appearance-scaling gate
  ([check_appearance_scaling.py](../../../../scripts/check_appearance_scaling.py),
  owned by
  [systems/product/settings/appearance-scaling.md](../../systems/product/settings/appearance-scaling.md)).
- **No re-implemented library behavior.** A feature component must not build
  its own popover positioning, its own dialog focus-trap, or any other
  behavior a library primitive/pattern already owns — compose the existing
  one instead of shadowing it.

Feature code may still define feature-specific components — a component that
only composes library primitives/patterns and tokens does not need to live in
the library. A component graduates **into** the library when it becomes the
canonical implementation for its job, or gets reused across independent
feature surfaces; at that point it moves to the tier matching its role and
gets a row in the sanctioned index below.

## The Sanctioned Index

Every component below has a canonical `package.json` `exports` subpath (no
aliases — one path per component) and a row here. A styled component with no
row here is not library-sanctioned; the index is the closed set, not a
sample of it.

### Primitives (`ui/src/primitives/`)

| Component | Path | Purpose |
| --- | --- | --- |
| `AlertDialog` | [AlertDialog.tsx](../../../../apps/packages/ui/src/primitives/AlertDialog.tsx) | Raw `@radix-ui/react-alert-dialog` wrapper, styled to tokens. |
| `AnimatedCollapsibleContent` | [AnimatedCollapsibleContent.tsx](../../../../apps/packages/ui/src/primitives/AnimatedCollapsibleContent.tsx) | Height + opacity disclosure motion for expand/collapse content; collapsed subtree is inert. |
| `AnimatedSwapText` | [AnimatedSwapText.tsx](../../../../apps/packages/ui/src/primitives/AnimatedSwapText.tsx) | Crossfade transition when a keyed text value changes. |
| `Badge` | [Badge.tsx](../../../../apps/packages/ui/src/primitives/Badge.tsx) | Tone-based label/status chip. |
| `Button` | [Button.tsx](../../../../apps/packages/ui/src/primitives/Button.tsx) | The button primitive — variant/size/loading/destructive API every other button-shaped component composes. |
| `Checkbox` | [Checkbox.tsx](../../../../apps/packages/ui/src/primitives/Checkbox.tsx) | One-line re-export of `checkbox-primitive` — see Collision pairs below. |
| `checkbox-primitive` | [checkbox-primitive.tsx](../../../../apps/packages/ui/src/primitives/checkbox-primitive.tsx) | Raw `@radix-ui/react-checkbox` wrapper — see Collision pairs below. |
| `Command` | [Command.tsx](../../../../apps/packages/ui/src/primitives/Command.tsx) | Raw `cmdk` wrapper. `CommandPalette` (below) imports `cmdk` directly rather than this wrapper; today's only consumer is [WorkspacesCommandList.tsx](../../../../apps/packages/product-ui/src/workspaces/WorkspacesCommandList.tsx) — two parallel `cmdk` consumers, a transitional gap, not a migration in progress. |
| `Dialog` | [Dialog.tsx](../../../../apps/packages/ui/src/primitives/Dialog.tsx) | Raw `@radix-ui/react-dialog` wrapper; `ModalShell` composes it. |
| `DropdownMenu` | [DropdownMenu.tsx](../../../../apps/packages/ui/src/primitives/DropdownMenu.tsx) | Raw `@radix-ui/react-dropdown-menu` wrapper — see DropdownMenu status below. |
| `FixedPositionLayer` | [FixedPositionLayer.tsx](../../../../apps/packages/ui/src/primitives/FixedPositionLayer.tsx) | Fixed-position wrapper for viewport-anchored overlay content. |
| `IconButton` | [IconButton.tsx](../../../../apps/packages/ui/src/primitives/IconButton.tsx) | Icon-only button, tone/size variants. |
| `Input` | [Input.tsx](../../../../apps/packages/ui/src/primitives/Input.tsx) | Text input field. |
| `Label` | [Label.tsx](../../../../apps/packages/ui/src/primitives/Label.tsx) | Form field label. |
| `LevelBarsButton` | [LevelBarsButton.tsx](../../../../apps/packages/ui/src/primitives/LevelBarsButton.tsx) | Stepped-level control button (level-bars affordance), composes `ComposerControlButton`. |
| `PaneIconButton` | [PaneIconButton.tsx](../../../../apps/packages/ui/src/primitives/PaneIconButton.tsx) | Pane-scoped icon button (size-6 box), composes `Button`. |
| `Popover` | [Popover.tsx](../../../../apps/packages/ui/src/primitives/Popover.tsx) | Raw `@radix-ui/react-popover` wrapper; `PopoverButton` composes it. |
| `PopoverButton` | [PopoverButton.tsx](../../../../apps/packages/ui/src/primitives/PopoverButton.tsx) | Popover-backed trigger/content wrapper with `triggerMode` (`click`/`doubleClick`/`contextMenu`); the sanctioned menu/popover trigger. |
| `PopoverMenuItem` | [PopoverMenuItem.tsx](../../../../apps/packages/ui/src/primitives/PopoverMenuItem.tsx) | Plain-button popover menu row; the sanctioned menu-item companion to `PopoverButton`. |
| `PopoverSearchField` | [PopoverSearchField.tsx](../../../../apps/packages/ui/src/primitives/PopoverSearchField.tsx) | Search input for popover pickers, with an in-place list-navigation keyboard hook. |
| `ProgressBar` | [ProgressBar.tsx](../../../../apps/packages/ui/src/primitives/ProgressBar.tsx) | Determinate progress bar. |
| `RadioCardGroup` | [RadioCardGroup.tsx](../../../../apps/packages/ui/src/primitives/RadioCardGroup.tsx) | Radio-selectable card group with label/description/icon per option. |
| `RangeSlider` | [RangeSlider.tsx](../../../../apps/packages/ui/src/primitives/RangeSlider.tsx) | Native range input styled to tokens. |
| `RowActionIconButton` | [RowActionIconButton.tsx](../../../../apps/packages/ui/src/primitives/RowActionIconButton.tsx) | Sanctioned hover-revealed row-action icon button (sidebar kebab, archive, tab close, file-row actions) — 28px hit target, 16px glyph. |
| `SegmentedControl` | [SegmentedControl.tsx](../../../../apps/packages/ui/src/primitives/SegmentedControl.tsx) | Segmented tab-like control. |
| `Select` | [Select.tsx](../../../../apps/packages/ui/src/primitives/Select.tsx) | Native select styled to tokens. |
| `ShortcutBadge` | [ShortcutBadge.tsx](../../../../apps/packages/ui/src/primitives/ShortcutBadge.tsx) | Keyboard-shortcut badge. |
| `Skeleton` | [Skeleton.tsx](../../../../apps/packages/ui/src/primitives/Skeleton.tsx) | Shimmer loading placeholder block. |
| `Sonner` | [Sonner.tsx](../../../../apps/packages/ui/src/primitives/Sonner.tsx) | Raw `sonner` toast wrapper, styled to tokens. |
| `Spinner` | [Spinner.tsx](../../../../apps/packages/ui/src/primitives/Spinner.tsx) | Inline loading spinner. |
| `Switch` | [Switch.tsx](../../../../apps/packages/ui/src/primitives/Switch.tsx) | Toggle switch. |
| `Textarea` | [Textarea.tsx](../../../../apps/packages/ui/src/primitives/Textarea.tsx) | Multi-line text input (default/ghost/flush/code variants). |
| `Tooltip` | [Tooltip.tsx](../../../../apps/packages/ui/src/primitives/Tooltip.tsx) | Formatting wrapper over `tooltip-primitive` — see Collision pairs below. |
| `tooltip-primitive` | [tooltip-primitive.tsx](../../../../apps/packages/ui/src/primitives/tooltip-primitive.tsx) | Raw `@radix-ui/react-tooltip` wrapper — see Collision pairs below. |
| `UserAvatar` | [UserAvatar.tsx](../../../../apps/packages/ui/src/primitives/UserAvatar.tsx) | Person avatar with initials fallback (`userInitials()` helper). |

**Collision pairs (transitional).** Two primitive families ship both a raw
wrapper and a same-tier overlay under names that would otherwise collide:
`checkbox-primitive.tsx` (the raw `@radix-ui/react-checkbox` wrapper) sits
alongside `Checkbox.tsx` (a one-line re-export of it), and
`tooltip-primitive.tsx` (the raw `@radix-ui/react-tooltip` wrapper) sits
alongside `Tooltip.tsx` (a formatting wrapper over it, adding `singleLine`
handling). Both pairs are two entry points onto one implementation, not
duplicate components — the lowercase `-primitive` module is the base layer,
the PascalCase module is the styled call-site entry point most consumers use.

**`DropdownMenu` status.** `DropdownMenu.tsx` is a legacy menu system living
alongside the sanctioned `PopoverButton`/`PopoverMenuItem` pair, not a second
tier. Four files still import it directly:
[WorkspaceItemMenu.tsx](../../../../apps/packages/product-client/src/components/workspace/shell/sidebar/WorkspaceItemMenu.tsx),
[RightPanelNewTabMenu.tsx](../../../../apps/packages/product-client/src/components/workspace/shell/right-panel/RightPanelNewTabMenu.tsx),
[WorkspaceActionsMenu.tsx](../../../../apps/packages/product-client/src/components/workspace/shell/topbar/WorkspaceActionsMenu.tsx)
(all `product-client`), and
[ProposedPlanCard.tsx](../../../../apps/packages/product-ui/src/chat/transcript/ProposedPlanCard.tsx)
(`product-ui`). Migrating them onto `PopoverButton`/`PopoverMenuItem` is
pending: Radix's dropdown-menu primitive provides roving-tabindex arrow-key
navigation, typeahead, and managed focus-return-to-trigger that
`PopoverButton`/`PopoverMenuItem` do not implement today. `DropdownMenu` is
not banned outright — it has no CI gate — but new menu call sites should use
`PopoverButton`/`PopoverMenuItem`; only the four existing consumers above are
grandfathered.

### Patterns (`ui/src/patterns/`)

| Component | Path | Purpose |
| --- | --- | --- |
| `AuthProviderButton` | [AuthProviderButton.tsx](../../../../apps/packages/ui/src/patterns/AuthProviderButton.tsx) | Auth-provider sign-in button with a loading state, composes `Spinner`. |
| `AutoHideScrollArea` | [AutoHideScrollArea.tsx](../../../../apps/packages/ui/src/patterns/AutoHideScrollArea.tsx) | Scroll area whose scrollbar affordance auto-hides. |
| `CommandPalette` | [CommandPalette.tsx](../../../../apps/packages/ui/src/patterns/CommandPalette.tsx) | Command-palette shell/context, built directly on `cmdk` (not on the `Command` primitive — see `Command` row above). |
| `ComposerActionButton` | [ComposerActionButton.tsx](../../../../apps/packages/ui/src/patterns/ComposerActionButton.tsx) | Composer primary-action button, composes `Button`. |
| `ComposerControlButton` | [ComposerControlButton.tsx](../../../../apps/packages/ui/src/patterns/ComposerControlButton.tsx) | Composer control pill (icon/label/detail/trailing/active), composes `Button`. |
| `ComposerTextarea` | [ComposerTextarea.tsx](../../../../apps/packages/ui/src/patterns/ComposerTextarea.tsx) | Composer-sized text input, composes `Textarea`. |
| `ComposerTextareaFrame` | [ComposerTextareaFrame.tsx](../../../../apps/packages/ui/src/patterns/ComposerTextareaFrame.tsx) | Composer textarea's outer frame/top-inset shell. |
| `ConfirmationDialog` | [ConfirmationDialog.tsx](../../../../apps/packages/ui/src/patterns/ConfirmationDialog.tsx) | Confirm/cancel dialog, built on `ModalShell` + `Button`. |
| `EmptyState` | [EmptyState.tsx](../../../../apps/packages/ui/src/patterns/EmptyState.tsx) | Title/description/action empty-state block. |
| `EnvironmentSearchSelect` | [EnvironmentSearchSelect.tsx](../../../../apps/packages/ui/src/patterns/EnvironmentSearchSelect.tsx) | Searchable environment picker, composes `PopoverButton`/`PopoverMenuItem`/`PickerPopoverContent`. |
| `ListRow` | [ListRow.tsx](../../../../apps/packages/ui/src/patterns/ListRow.tsx) | Clickable list row with leading/trailing slots. |
| `ModalShell` | [ModalShell.tsx](../../../../apps/packages/ui/src/patterns/ModalShell.tsx) | Modal composition built on `Dialog`. |
| `PageContentFrame` | [PageContentFrame.tsx](../../../../apps/packages/ui/src/patterns/PageContentFrame.tsx) | Page content frame with header slot and sticky action/title. |
| `PageHeader` | [PageHeader.tsx](../../../../apps/packages/ui/src/patterns/PageHeader.tsx) | Page-level header (title/description/actions). |
| `PaneOptionsMenuItem` | [PaneOptionsMenuItem.tsx](../../../../apps/packages/ui/src/patterns/PaneOptionsMenuItem.tsx) | Pane options-menu row, composes `Button`. |
| `PickerPopoverContent` | [PickerPopoverContent.tsx](../../../../apps/packages/ui/src/patterns/PickerPopoverContent.tsx) | Popover content shell for pickers: search field + list + empty row. |
| `SettingsMenu` | [SettingsMenu.tsx](../../../../apps/packages/ui/src/patterns/SettingsMenu.tsx) | Labeled select-style menu, composes `PopoverButton`/`PopoverMenuItem`. |
| `SidebarActionButton` | [SidebarActionButton.tsx](../../../../apps/packages/ui/src/patterns/SidebarActionButton.tsx) | Sidebar action button, composes `RowActionIconButton`. |
| `SidebarNavRow` | [SidebarNavRow.tsx](../../../../apps/packages/ui/src/patterns/SidebarNavRow.tsx) | Sidebar navigation row (icon/label/status/shortcut), composes the `ShortcutBadge` primitive + `SidebarRowSurface`. |
| `SidebarRowSurface` | [SidebarRowSurface.tsx](../../../../apps/packages/ui/src/patterns/SidebarRowSurface.tsx) | Shared sidebar row interaction surface (active/disabled/press state) other sidebar rows build on. |
| `ThinkingText` | [ThinkingText.tsx](../../../../apps/packages/ui/src/patterns/ThinkingText.tsx) | Animated "thinking" gleam text. |

### Icons (`ui/src/icons/`)

| Component | Path | Purpose |
| --- | --- | --- |
| `icons` (barrel) | [index.tsx](../../../../apps/packages/ui/src/icons/index.tsx) | General glyph set — re-exports the `core`/`workspace`/`product`/`platform`/`status`/`app-shell` detail modules. |
| `command-palette-icons` | [command-palette-icons.tsx](../../../../apps/packages/ui/src/icons/command-palette-icons.tsx) | Icon set scoped to the command palette. |
| `proliferate-icons` | [proliferate-icons.tsx](../../../../apps/packages/ui/src/icons/proliferate-icons.tsx) | The Proliferate brand-mark glyph. |
| `provider-icons` | [provider-icons.tsx](../../../../apps/packages/ui/src/icons/provider-icons.tsx) | Auth/model-provider brand glyphs, composes `proliferate-icons` for the Proliferate entry. |

### Patterns — domain-aware (`product-ui/src/patterns/`)

| Component | Path | Purpose |
| --- | --- | --- |
| `ModelTable` | [ModelTable.tsx](../../../../apps/packages/product-ui/src/patterns/ModelTable.tsx) | Model-config table rows, composes `Badge`/`Switch`. |
| `PrStatusBadge` | [PrStatusBadge.tsx](../../../../apps/packages/product-ui/src/patterns/PrStatusBadge.tsx) | PR status dot (`PrStatusDot`), icon-overlay wrapper (`PrStatusIconOverlay`), and tooltip-text helper (`prStatusTooltip`); hand-rolls its own tone map, composes nothing. |
| `ProductPageShell` | [ProductPageShell.tsx](../../../../apps/packages/product-ui/src/patterns/ProductPageShell.tsx) | General product page shell, composes `PageContentFrame` + `PageHeader`. |
| `SettingsEmptyState` | [SettingsEmptyState.tsx](../../../../apps/packages/product-ui/src/patterns/SettingsEmptyState.tsx) | Settings-scoped empty state (compact/full sizes). |
| `SettingsEyebrow` | [SettingsEyebrow.tsx](../../../../apps/packages/product-ui/src/patterns/SettingsEyebrow.tsx) | Settings section eyebrow label. |
| `SettingsPageHeader` | [SettingsPageHeader.tsx](../../../../apps/packages/product-ui/src/patterns/SettingsPageHeader.tsx) | Flat settings page header (title/description/action). |
| `SettingsRow` | [SettingsRow.tsx](../../../../apps/packages/product-ui/src/patterns/SettingsRow.tsx) | Settings row (label/description/control), fixed 240px control-width companion for menus. |
| `SettingsSaveFooter` | [SettingsSaveFooter.tsx](../../../../apps/packages/product-ui/src/patterns/SettingsSaveFooter.tsx) | Settings save/revert footer with a status badge, composes `Badge` + `Button`. |
| `SettingsScopeTabs` | [SettingsScopeTabs.tsx](../../../../apps/packages/product-ui/src/patterns/SettingsScopeTabs.tsx) | User/org/repo/agents underline scope-switcher tabs, composes `Button`. |
| `SettingsSection` | [SettingsSection.tsx](../../../../apps/packages/product-ui/src/patterns/SettingsSection.tsx) | Settings section (title/description), composes `SettingsEyebrow`. |
| `secrets/SecretManagementPanel` | [secrets/SecretManagementPanel.tsx](../../../../apps/packages/product-ui/src/patterns/secrets/SecretManagementPanel.tsx) | Presentational secrets-management pattern (list, editor/delete dialogs, scope notice are private internals of this one export). |

## How To Add A Component

1. **Design against tokens.** Use `design`'s type ramp, spacing, radii, and
   motion values ([design-system.md](design-system.md)) — never an arbitrary
   value at the component or the callsite.
2. **Place it in the right tier**, by role, not by the feature that needed
   it: a raw Radix/vendor wrapper or single-purpose atom goes in
   `ui/src/primitives/`; a composition of those goes in `ui/src/patterns/`
   (or `product-ui/src/patterns/` if it needs `product-domain`); an icon set
   goes in `ui/src/icons/`.
3. **Add one export-map entry** — a canonical subpath in the owning
   package's `package.json` `exports` (`./primitives/<Component>`,
   `./patterns/<Component>`, `./icons/<name>`). No aliases: one subpath per
   component, matching its file name.
4. **Add a row to the sanctioned index above** — component name, real path,
   one-line purpose, in the matching tier's table.
5. **Consume it** via the exact export-map subpath
   (`@proliferate/ui/primitives/Button`,
   `@proliferate/product-ui/patterns/SettingsRow`) — never a relative import
   across a package boundary, never a barrel.

## Failure Modes

| Condition | What a consumer observes | Recovery |
| --- | --- | --- |
| A `@radix-ui/*` import lands outside `ui/src/primitives/**` or `ui/src/patterns/**` | `RADIX_IMPORT_OUTSIDE_UI_COMPONENT_LIBRARY` fails in [check_frontend_boundaries.py](../../../../scripts/check_frontend_boundaries.py), naming the file and line | Move the wrapper into the library, or compose the existing library primitive instead of importing Radix directly |
| A new top-level entry is added under `ui/src` outside the six allowed dirs | `UI_SRC_TOP_LEVEL_ENTRY` fails, naming the offending entry | Move the content into `primitives/`, `patterns/`, or `icons/` per its role |
| A component hardcodes a color/spacing/radius/duration value instead of a token | `check_appearance_scaling.py` fails in pre-commit and CI (see [appearance-scaling.md](../../systems/product/settings/appearance-scaling.md)) | Replace with the ruled token utility |
| A styled component ships outside the library with no library equivalent and gets reused across surfaces | No mechanical check catches this today — it is caught only by review | Promote it into the matching tier per "How To Add A Component" above |

## Current Gaps

- Nothing mechanically verifies that every `exports` subpath in `ui/src` or
  `product-ui/src/patterns` has a row in the sanctioned index above, or that
  every row still points at a real export. Both directions are kept in sync
  by hand; drift is a documentation bug, not a CI failure.
- `DropdownMenu`'s four grandfathered consumers (see DropdownMenu status
  above) have no tracking mechanism beyond this document — nothing fails CI
  if a fifth call site starts importing `DropdownMenu` directly.

Test coverage for the two mechanical rules above:
[test_check_frontend_boundaries.py](../../../../scripts/test_check_frontend_boundaries.py).
