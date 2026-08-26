import type { HTMLAttributes, KeyboardEvent, MouseEvent, ReactNode } from "react";

import { twMerge } from "#product/primitives/utils/tw-merge";

/**
 * The roster/list-panel row skeleton: leading glyph or status indicator,
 * primary line with an optional secondary line beneath it, always-visible
 * trailing meta, and hover-revealed trailing actions.
 *
 * This is the list-panel row, not the sidebar nav row — sidebar navigation
 * composes `SidebarNavRow`/`SidebarRowSurface` (fixed 30px chrome geometry,
 * sidebar ink tokens). `RosterRow` is the shape that agent rosters, workflow
 * run/definition lists, terminal rosters and session lists all hand-rolled
 * independently (`SubagentRosterRow` and `TerminalRosterRow` are near-verbatim
 * copies of each other; `WorkflowRunList` and `WorkflowDefinitionList` inline
 * the same skeleton over a `Button variant="unstyled"`).
 *
 * It owns the whole interaction-state stack so no roster call site
 * hand-assembles one: hover, selection, press and focus-visible all paint from
 * the shared state tokens. Hover is suppressed on an already-selected row so a
 * committed selection never reads weaker than a transient hover (the same
 * rationale `SidebarRowSurface` carries).
 *
 * Trailing actions: the row is a hover group, and the sanctioned row-action
 * button (`RowActionIconButton`) already owns the `opacity-0` →
 * `group-hover:opacity-100` reveal contract taught in
 * `specs/areas/styling.md`. The `actions` slot therefore only lays out — it
 * does not restate the reveal, because a state contract has exactly one owner.
 */

type RosterRowDensity = "compact" | "comfortable";

/**
 * Padding, gap and title type ride one axis. A panel roster (activity chips,
 * popover rosters) is compact; a page-level list (workflow definitions/runs)
 * is comfortable. There is deliberately no second geometry axis: cross-axis
 * needs are a redesign conversation, not another prop.
 */
const DENSITY_ROW_CLASS: Record<RosterRowDensity, string> = {
  compact: "gap-2 rounded-md px-1.5 py-1.5",
  comfortable: "gap-3 rounded-lg px-3 py-2.5",
};

const DENSITY_TITLE_CLASS: Record<RosterRowDensity, string> = {
  compact: "text-ui",
  comfortable: "text-body",
};

export interface RosterRowProps extends Omit<HTMLAttributes<HTMLDivElement>, "onSelect" | "title"> {
  /**
   * Leading glyph, status dot, or avatar. The slot is `aria-hidden`: it is a
   * decorative mark, and the row's accessible name is `title`. A `StatusDot`
   * placed here is silenced, so any status the row must announce belongs in
   * `secondary` or `trailing` text.
   */
  leading?: ReactNode;
  /** Primary line. Truncates — rosters are narrow and their titles are long. */
  title: ReactNode;
  /** Secondary line under the title (status · elapsed · path, a description). */
  secondary?: ReactNode;
  /** Always-visible trailing meta: a timestamp, a count, a status label. */
  trailing?: ReactNode;
  /** Hover-revealed trailing actions. Pass `RowActionIconButton`s. */
  actions?: ReactNode;
  density?: RosterRowDensity;
  /** Persistent selection paint. */
  selected?: boolean;
  disabled?: boolean;
  /** Omit for a read-only roster row; the row is interactive only with it. */
  onSelect?: () => void;
}

export function RosterRow({
  leading,
  title,
  secondary,
  trailing,
  actions,
  density = "compact",
  selected = false,
  disabled = false,
  onSelect,
  className = "",
  onClick: onClickProp,
  onKeyDown: onKeyDownProp,
  ...props
}: RosterRowProps) {
  const interactive = typeof onSelect === "function" && !disabled;

  // Interactive rows render a div with button semantics rather than a real
  // <button>: a roster row's whole point is that it carries its own trailing
  // action buttons, and a button inside a button is invalid DOM. This is the
  // same trade `SidebarRowSurface` makes for the same reason, with the same
  // Enter/Space handling so keyboard activation still works.
  const stateClass = disabled
    ? "text-muted-foreground"
    : selected
      ? "bg-selected text-foreground active:bg-active"
      : interactive
        ? "text-foreground hover:bg-hover active:bg-active"
        : "text-foreground";

  const rowClassName = twMerge(
    `group relative flex w-full min-w-0 text-left transition-colors duration-hover ${
      secondary ? "items-start" : "items-center"
    } ${DENSITY_ROW_CLASS[density]} ${
      interactive
        ? "cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        : ""
    } ${disabled ? "cursor-not-allowed opacity-60" : ""} ${stateClass}`,
    className,
  );

  // The row's own activation runs first, then the caller's handler — a
  // consumer that also wants the raw DOM event (context menus, drag starts)
  // must not have it silently swallowed by this pattern's props spread.
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (interactive && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      onSelect();
    }
    onKeyDownProp?.(event);
  };

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (interactive) {
      onSelect();
    }
    onClickProp?.(event);
  };

  return (
    <div
      {...props}
      role={onSelect ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-disabled={disabled || undefined}
      data-selected={selected}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={rowClassName}
    >
      {leading ? (
        <span
          className={`flex shrink-0 items-center justify-center ${secondary ? "mt-0.5" : ""}`}
          aria-hidden
        >
          {leading}
        </span>
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={`truncate ${DENSITY_TITLE_CLASS[density]}`}>{title}</span>
        {secondary ? (
          <span className="mt-0.5 min-w-0 text-ui-sm leading-4 text-muted-foreground">{secondary}</span>
        ) : null}
      </span>
      {trailing ? (
        <span className={`shrink-0 text-ui-sm text-muted-foreground ${secondary ? "mt-0.5" : ""}`}>
          {trailing}
        </span>
      ) : null}
      {actions ? <span className="flex shrink-0 items-center gap-0.5">{actions}</span> : null}
    </div>
  );
}
