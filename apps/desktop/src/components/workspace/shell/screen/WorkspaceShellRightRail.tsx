import type { ComponentProps, MouseEventHandler } from "react";
import { DebugProfiler } from "@/components/diagnostics/DebugProfiler";
import { RightPanel } from "@/components/workspace/shell/right-panel/RightPanel";
import { WorkspaceResizeSeparator } from "@/components/workspace/shell/screen/WorkspaceResizeSeparator";

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
        className="shrink-0 overflow-hidden transition-[width] duration-150 ease-in-out"
        style={{ width: open ? width : 0 }}
      >
        <DebugProfiler id="workspace-right-panel">
          <div className="h-full" style={{ minWidth: 260 }}>
            <RightPanel isOpen={open} {...rightPanelProps} />
          </div>
        </DebugProfiler>
      </div>
    </>
  );
}
