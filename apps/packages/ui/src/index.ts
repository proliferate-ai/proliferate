/**
 * Root barrel for the package's `.` export. Re-exports every module the
 * package.json `exports` map already publishes as a subpath, so subpath and
 * root imports resolve to the same declarations.
 *
 * Name collisions across subpath modules are pinned explicitly below the star
 * exports (an explicit re-export always beats `export *`, which silently
 * drops ambiguous names), matching the playground registry naming:
 * - `Checkbox` is the styled primitive from `primitives/Checkbox`; the
 *   checkbox-primitive module's `Checkbox` is exposed as `CheckboxPrimitive`.
 * - `Tooltip` is the content-prop wrapper from `primitives/Tooltip`; the
 *   tooltip-primitive module's compound root is exposed as `TooltipPrimitive`
 *   (its `TooltipContent`/`TooltipTrigger`/`TooltipProvider` parts are
 *   unambiguous and export normally).
 * - `Spinner` is the component from `primitives/Spinner`; the icons subpath
 *   re-exports that same declaration, which stays reachable via
 *   `@proliferate/ui/icons`.
 */
export * from "./icons/command-palette-icons";
export * from "./icons/index";
export * from "./icons/proliferate-icons";
export * from "./icons/provider-icons";
export * from "./lib/utils";
export * from "./overlays/overlay-presence";
export * from "./patterns/AuthProviderButton";
export * from "./patterns/AutoHideScrollArea";
export * from "./patterns/CommandPalette";
export * from "./patterns/ComposerActionButton";
export * from "./patterns/ComposerControlButton";
export * from "./patterns/ComposerTextarea";
export * from "./patterns/ComposerTextareaFrame";
export * from "./patterns/ConfirmationDialog";
export * from "./patterns/EmptyState";
export * from "./patterns/EnvironmentSearchSelect";
export * from "./patterns/LevelBarsButton";
export * from "./patterns/ListRow";
export * from "./patterns/ModalShell";
export * from "./patterns/PageContentFrame";
export * from "./patterns/PageHeader";
export * from "./patterns/PaneOptionsMenuItem";
export * from "./patterns/PickerPopoverContent";
export * from "./patterns/SettingsMenu";
export * from "./patterns/SidebarActionButton";
export * from "./patterns/SidebarNavRow";
export * from "./patterns/SidebarRowSurface";
export * from "./patterns/ThinkingText";
export * from "./primitives/AlertDialog";
export * from "./primitives/AnimatedCollapsibleContent";
export * from "./primitives/AnimatedSwapText";
export * from "./primitives/Badge";
export * from "./primitives/Button";
export * from "./primitives/Checkbox";
export * from "./primitives/Command";
export * from "./primitives/Dialog";
export * from "./primitives/DropdownMenu";
export * from "./primitives/FixedPositionLayer";
export * from "./primitives/IconButton";
export * from "./primitives/Input";
export * from "./primitives/Label";
export * from "./primitives/PaneIconButton";
export * from "./primitives/Popover";
export * from "./primitives/PopoverButton";
export * from "./primitives/PopoverMenuItem";
export * from "./primitives/PopoverSearchField";
export * from "./primitives/ProgressBar";
export * from "./primitives/RadioCardGroup";
export * from "./primitives/RangeSlider";
export * from "./primitives/RowActionIconButton";
export * from "./primitives/SegmentedControl";
export * from "./primitives/Select";
export * from "./primitives/ShortcutBadge";
export * from "./primitives/Skeleton";
export * from "./primitives/Sonner";
export * from "./primitives/Spinner";
export * from "./primitives/Switch";
export * from "./primitives/Textarea";
export * from "./primitives/Tooltip";
export * from "./primitives/TypewriterRevealText";
export * from "./primitives/UserAvatar";
export * from "./primitives/checkbox-primitive";
export * from "./primitives/tooltip-primitive";
export * from "./utils/scroll-chain";
export * from "./utils/search";
export * from "./utils/tw-merge";

export { Checkbox } from "./primitives/Checkbox";
export { Checkbox as CheckboxPrimitive } from "./primitives/checkbox-primitive";
export { Tooltip } from "./primitives/Tooltip";
export { Tooltip as TooltipPrimitive } from "./primitives/tooltip-primitive";
export { Spinner } from "./primitives/Spinner";
