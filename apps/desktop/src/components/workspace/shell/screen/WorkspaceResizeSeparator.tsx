import type { MouseEventHandler } from "react";

/**
 * Vertical drag handle between the workspace shell panels. The negative
 * margin keeps the 4px hit area overlapping the adjacent panel edge.
 */
export function WorkspaceResizeSeparator({
  edge,
  onMouseDown,
  ariaControls,
}: {
  edge: "left" | "right";
  onMouseDown: MouseEventHandler<HTMLDivElement>;
  ariaControls?: string;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-controls={ariaControls}
      onMouseDown={onMouseDown}
      className={`relative z-10 flex w-1 shrink-0 cursor-col-resize items-center justify-center ${
        edge === "left" ? "-ml-1" : "-mr-1"
      } hover:bg-primary/30 active:bg-primary/50 transition-colors`}
    />
  );
}
