import type { ComponentProps, MouseEventHandler } from "react";
import { DebugProfiler } from "#product/components/diagnostics/DebugProfiler";
import { RightPanel } from "#product/components/workspace/shell/right-panel/RightPanel";
import { WorkspaceResizeSeparator } from "#product/components/workspace/shell/screen/WorkspaceResizeSeparator";
import { RIGHT_PANEL_MIN_WIDTH } from "#product/lib/domain/workspaces/shell/right-panel-model";

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
        // shut instead.
        className="isolate shrink-0 overflow-hidden transition-[width] duration-panel ease-standard"
        style={{ width: open ? width : 0 }}
      >
        <DebugProfiler id="workspace-right-panel">
          {/* Pinning the panel body at the domain minimum keeps its content laid
              out at a legible width while the container width animates to 0, so
              a collapse slides the panel out instead of crushing its chrome. */}
          <div className="h-full" style={{ minWidth: RIGHT_PANEL_MIN_WIDTH }}>
            <RightPanel isOpen={open} {...rightPanelProps} />
          </div>
        </DebugProfiler>
      </div>
    </>
  );
}
