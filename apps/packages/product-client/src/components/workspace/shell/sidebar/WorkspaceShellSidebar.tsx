import { DebugProfiler } from "#product/components/diagnostics/DebugProfiler";
import { MainSidebar } from "#product/components/workspace/shell/sidebar/MainSidebar";
import { WorkspaceSidebarHeaderControls } from "#product/components/workspace/shell/sidebar/WorkspaceSidebarHeaderControls";

interface WorkspaceShellSidebarProps {
  open: boolean;
  width: number;
  edgeClassName?: string;
  onToggleSidebar: () => void;
}

export function WorkspaceShellSidebar({
  open,
  width,
  edgeClassName = "",
  onToggleSidebar,
}: WorkspaceShellSidebarProps) {
  return (
    <div
      id="main-sidebar"
      // isolate: the resize separator's hit strip overlaps this edge (z-10 in
      // the page context); a local stacking context keeps sidebar-internal
      // z-indexes from painting over the dragger.
      className={`isolate flex shrink-0 flex-col overflow-hidden bg-sidebar transition-[width] duration-panel ease-in-out ${edgeClassName}`}
      style={{ width: open ? width : 0 }}
    >
      <DebugProfiler id="workspace-sidebar-frame">
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex h-10 shrink-0 items-center" data-tauri-drag-region="true">
            <WorkspaceSidebarHeaderControls
              className="pl-[82px]"
              toggleTitle="Hide sidebar"
              iconTone="sidebar"
              onToggleSidebar={onToggleSidebar}
            />
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">
            <MainSidebar />
          </div>
        </div>
      </DebugProfiler>
    </div>
  );
}
