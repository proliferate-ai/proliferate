import type { MouseEventHandler } from "react";

/**
 * Vertical drag handle between the workspace shell panels. The negative
 * margin keeps the 4px hit area overlapping the adjacent panel edge; hover
 * and drag feedback stays a 1px line pinned to the panel boundary so it
 * brightens the existing hairline instead of filling the hit area.
 */
export function WorkspaceResizeSeparator({
  edge,
  onMouseDown,
  onDoubleClick,
  ariaControls,
  ariaLabel,
  title,
}: {
  edge: "left" | "right";
  onMouseDown: MouseEventHandler<HTMLDivElement>;
  onDoubleClick?: MouseEventHandler<HTMLDivElement>;
  ariaControls?: string;
  ariaLabel?: string;
  title?: string;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-controls={ariaControls}
      aria-label={ariaLabel}
      title={title}
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      className={`relative z-10 w-1 shrink-0 cursor-col-resize before:absolute before:inset-y-0 before:w-[0.5px] before:transition-colors ${
        edge === "left" ? "-ml-1 before:right-0" : "-mr-1 before:left-0"
      } hover:before:bg-border-heavy active:before:bg-primary/30`}
    />
  );
}
