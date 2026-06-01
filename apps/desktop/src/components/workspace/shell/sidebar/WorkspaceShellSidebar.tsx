import { DebugProfiler } from "@/components/diagnostics/DebugProfiler";
import { MainSidebar } from "@/components/workspace/shell/sidebar/MainSidebar";
import { WorkspaceSidebarHeaderControls } from "@/components/workspace/shell/sidebar/WorkspaceSidebarHeaderControls";
import type { UpdaterPhase } from "@/stores/updater/updater-store";

interface WorkspaceShellSidebarProps {
  open: boolean;
  width: number;
  updaterPhase: UpdaterPhase;
  downloadProgress: number | null;
  onToggleSidebar: () => void;
  onDownloadUpdate: () => void;
  onOpenRestartPrompt: () => void;
}

export function WorkspaceShellSidebar({
  open,
  width,
  updaterPhase,
  downloadProgress,
  onToggleSidebar,
  onDownloadUpdate,
  onOpenRestartPrompt,
}: WorkspaceShellSidebarProps) {
  return (
    <div
      id="main-sidebar"
      className="flex shrink-0 flex-col overflow-hidden bg-sidebar transition-[width] duration-150 ease-in-out"
      style={{ width: open ? width : 0 }}
    >
      <DebugProfiler id="workspace-sidebar-frame">
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex h-10 shrink-0 items-center" data-tauri-drag-region="true">
            <WorkspaceSidebarHeaderControls
              className="pl-[82px]"
              toggleTitle="Hide sidebar"
              iconTone="sidebar"
              phase={updaterPhase}
              downloadProgress={downloadProgress}
              onToggleSidebar={onToggleSidebar}
              onDownloadUpdate={onDownloadUpdate}
              onOpenRestartPrompt={onOpenRestartPrompt}
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
