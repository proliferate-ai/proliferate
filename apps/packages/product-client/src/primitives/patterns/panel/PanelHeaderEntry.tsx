import type { ButtonHTMLAttributes, ReactNode } from "react";

import { RowActionIconButton } from "#product/primitives/RowActionIconButton";
import { StatusDot } from "#product/primitives/StatusDot";
import { AppShellTabCloseIcon } from "#product/primitives/icons/app-shell";
import { twMerge } from "#product/primitives/utils/tw-merge";

/**
 * Panel kit — the canonical header entry of a panel's header strip: a leading
 * glyph, a truncating label, an optional trailing slot, an optional
 * dirty/unread dot, and an optional close affordance revealed on hover.
 *
 * The shape is promoted from four hand-rolled implementations of the same
 * skeleton in the right-panel header (`ViewerHeaderButton`, `ToolHeaderButton`,
 * `TerminalHeaderButton`, `TerminalHeaderIcon`), which differ only in which
 * slots they fill.
 *
 * State ownership (DESIGN_SYSTEM.md § UI-conformance review, check 7): the
 * resting/hover/selected/press/disabled/focus-visible stack lives here, built
 * from the shared state tokens (`hover:bg-hover`, `bg-selected`,
 * `active:bg-active`, the sidebar focus ring) rather than from the
 * `.right-panel-tab-system` descendant CSS the hand-rolled entries depend on —
 * so an entry paints identically wherever it is mounted.
 *
 * Semantics: an entry is a tab in its panel's tablist, so it owns
 * `role="tab"`, `aria-selected`, the roving `tabIndex`, and the `aria-controls`
 * wiring. Reorder/drag attributes (`data-reorderable`, `aria-grabbed`,
 * `data-dragging`) and pointer handlers are caller-owned behavior and pass
 * through the rest props.
 *
 * Roving tabIndex has a floor: a strip whose entries are all inactive would
 * otherwise be keyboard-unreachable (every entry at `tabIndex=-1`). The
 * caller opts one entry — conventionally the first — into `tabIndexFloor` so
 * the strip always has exactly one focusable stop even with nothing selected.
 *
 * incubating: shell slice, wave 2
 */

/**
 * The close control is a `RowActionIconButton` sibling rather than a nested
 * button (a button inside a button is invalid DOM), positioned over the
 * entry's trailing edge with the label reserving room for it. It steps the
 * hand-rolled 16px close target up to `size-icon-button-sm`, the smallest
 * sanctioned icon-button box.
 */
const ENTRY_SHELL_CLASS =
  "group relative flex h-control min-w-0 shrink-0 items-center";

const ENTRY_BUTTON_CLASS =
  "flex h-control min-w-0 flex-1 cursor-pointer select-none items-center gap-2 rounded-sm px-2 text-left text-ui transition-[background-color,color] duration-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-sidebar-ring [&_svg]:icon-control";

const CLOSE_BUTTON_CLASS = "absolute end-1 size-icon-button-sm rounded-full";

export interface PanelHeaderEntryProps
  extends Omit<
    ButtonHTMLAttributes<HTMLButtonElement>,
    "aria-label" | "aria-selected" | "children" | "role" | "title" | "type"
  > {
  /** Visible text and, with no `title`, the accessible name. */
  label: string;
  /** Leading glyph. */
  icon?: ReactNode;
  /** Hover title and accessible name when the label is an abbreviation. */
  title?: string;
  /** The entry its panel is currently showing. */
  active?: boolean;
  /** Unsaved/unread marker rendered after the label. */
  dirty?: boolean;
  disabled?: boolean;
  /** Trailing slot: a diff marker, a shortcut hint, a count. */
  trailing?: ReactNode;
  /** Id of the panel this entry controls. */
  controls?: string;
  onSelect?: () => void;
  /** Renders the hover-revealed close control when supplied. */
  onClose?: () => void;
  /** Accessible name of the close control; defaults to `Close <label>`. */
  closeLabel?: string;
  /** Closing unavailable while the entry itself stays selectable. */
  closeDisabled?: boolean;
  /**
   * Roving-tabIndex floor: when no entry in the strip is `active`, exactly
   * one entry (the caller's first-entry fallback) must still carry
   * `tabIndex=0` so the strip stays keyboard-reachable. The caller computes
   * "no entry active" across its whole entry list and sets this on the one
   * entry that should absorb the floor; every other entry omits it.
   */
  tabIndexFloor?: boolean;
  /** Layout only — width, ordering, margins. */
  className?: string;
}

export function PanelHeaderEntry({
  label,
  icon,
  title,
  active = false,
  dirty = false,
  disabled = false,
  trailing,
  controls,
  onSelect,
  onClose,
  closeLabel,
  closeDisabled = false,
  tabIndexFloor = false,
  className = "",
  ...props
}: PanelHeaderEntryProps) {
  const stateClass = active
    ? "bg-selected text-sidebar-foreground"
    : disabled
      ? "text-sidebar-muted-foreground opacity-60"
      : "text-sidebar-muted-foreground hover:bg-hover hover:text-sidebar-foreground active:bg-active";

  return (
    <div className={twMerge(ENTRY_SHELL_CLASS, className)}>
      <button
        {...props}
        type="button"
        role="tab"
        aria-selected={active}
        aria-controls={controls}
        aria-label={title ?? label}
        title={title ?? label}
        tabIndex={active || (tabIndexFloor && !disabled) ? 0 : -1}
        disabled={disabled}
        data-active={active || undefined}
        onClick={onSelect}
        className={twMerge(
          ENTRY_BUTTON_CLASS,
          disabled ? "cursor-not-allowed" : "",
          onClose ? "pe-6" : "",
          stateClass,
        )}
      >
        {icon}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {trailing}
        {/* The dirty marker is the `StatusDot` primitive on `current`, not a
            second hand-rolled `icon-status rounded-full` span: the entry
            already inherits the tone it should paint in. */}
        {dirty && <StatusDot tone="current" />}
      </button>
      {onClose && (
        <RowActionIconButton
          label={closeLabel ?? `Close ${label}`}
          disabled={disabled || closeDisabled}
          onClick={onClose}
          className={CLOSE_BUTTON_CLASS}
        >
          <AppShellTabCloseIcon />
        </RowActionIconButton>
      )}
    </div>
  );
}
