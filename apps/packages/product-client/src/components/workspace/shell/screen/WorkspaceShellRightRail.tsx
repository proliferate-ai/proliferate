import type { ComponentProps, MouseEventHandler } from "react";
import { DebugProfiler } from "#product/components/diagnostics/DebugProfiler";
import { RightPanel } from "#product/components/workspace/shell/right-panel/RightPanel";
import { WorkspaceResizeSeparator } from "#product/components/workspace/shell/screen/WorkspaceResizeSeparator";
import {
  MAIN_PANE_MIN_WIDTH,
  RIGHT_PANEL_MIN_WIDTH,
} from "#product/lib/domain/workspaces/shell/right-panel-model";

interface WorkspaceShellRightRailProps
  extends Omit<ComponentProps<typeof RightPanel>, "isOpen"> {
  /** Whether the rail (separator + panel container) participates in layout. */
  visible: boolean;
  open: boolean;
  width: number;
  onSeparatorMouseDown: MouseEventHandler<HTMLDivElement>;
}

/**
 * Right-hand rail of the standard workspace shell: the resize separator plus
 * the width-animated container that hosts the right panel.
 */
export function WorkspaceShellRightRail({
  visible,
  open,
  width,
  onSeparatorMouseDown,
  ...rightPanelProps
}: WorkspaceShellRightRailProps) {
  if (!visible) {
    return null;
  }
  return (
    <>
      {open && (
        <WorkspaceResizeSeparator
          edge="right"
          onMouseDown={onSeparatorMouseDown}
        />
      )}
      <div
        // isolate: the separator's 4px hit strip overlaps this edge (z-10 in
        // the page context). Without a local stacking context, panel internals
        // with z-index ≥ 10 (viewer toolbar, sticky tab edges) paint over the
        // dragger.
        // The width transition is what makes drag-to-collapse read as a close
        // rather than a disappearance: the same panel duration that animates an
        // explicit toggle animates the collapse the drag triggered, and
        // `prefers-reduced-motion` zeroes `--duration-panel` so the panel snaps
        // shut instead. Live drags zero the geometry duration instead of
        // easing, so the edge lands on the cursor every frame.
        // The min() clamp keeps MAIN_PANE_MIN_WIDTH of this flex row for the
        // chat pane: the rail yields before the composer collapses. 100%
        // resolves against the row.
        className="relative isolate shrink-0 overflow-hidden bg-sidebar-background transition-[width] ease-out-cubic [transition-duration:var(--workspace-right-geometry-duration)]"
        style={{ width: `min(var(--workspace-right-width), calc(100% - ${MAIN_PANE_MIN_WIDTH}px))` }}
        data-right-panel-rail
      >
        <DebugProfiler id="workspace-right-panel">
          <div
            className={`absolute inset-y-0 right-0 transition-opacity will-change-opacity ${
              open
                ? "pointer-events-auto opacity-100 duration-enter ease-out-cubic"
                : "pointer-events-none opacity-0 duration-exit ease-out-cubic"
            }`}
            style={{ width: Math.max(width, RIGHT_PANEL_MIN_WIDTH) }}
            inert={!open}
            data-right-panel-content
          >
            <RightPanel isOpen={open} {...rightPanelProps} />
          </div>
        </DebugProfiler>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 z-raised w-px bg-border"
        />
      </div>
    </>
  );
}
