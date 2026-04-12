import { MainSidebar } from "@/components/workspace/shell/sidebar/MainSidebar";
import { SidebarUpdatePill } from "@/components/workspace/shell/SidebarUpdatePill";
import { IconButton } from "@/components/ui/IconButton";
import { SplitPanel } from "@/components/ui/icons";
import { useResize } from "@/hooks/layout/use-resize";
import { useUpdater } from "@/hooks/updater/use-updater";
import {
  WORKSPACE_SIDEBAR_MAX_WIDTH,
  WORKSPACE_SIDEBAR_MIN_WIDTH,
  useWorkspaceUiStore,
} from "@/stores/preferences/workspace-ui-store";
import { ConnectorCatalogPage } from "./ConnectorCatalogPage";

export function PowersScreen() {
  const sidebarOpen = useWorkspaceUiStore((s) => s.sidebarOpen);
  const sidebarWidth = useWorkspaceUiStore((s) => s.sidebarWidth);
  const setSidebarOpen = useWorkspaceUiStore((s) => s.setSidebarOpen);
  const setSidebarWidth = useWorkspaceUiStore((s) => s.setSidebarWidth);
  const {
    phase: updaterPhase,
    downloadUpdate,
    openRestartPrompt,
  } = useUpdater();

  const onLeftSeparatorDown = useResize({
    direction: "horizontal",
    size: sidebarWidth,
    onResize: setSidebarWidth,
    min: WORKSPACE_SIDEBAR_MIN_WIDTH,
    max: WORKSPACE_SIDEBAR_MAX_WIDTH,
  });

  return (
    <div className="h-screen flex overflow-hidden bg-sidebar" data-telemetry-block>
      <div
        id="main-sidebar"
        className="flex shrink-0 flex-col overflow-hidden transition-[width] duration-150 ease-in-out"
        style={{ width: sidebarOpen ? sidebarWidth : 0 }}
      >
        <div className="flex h-10 shrink-0 items-center" data-tauri-drag-region="true">
          <div className="flex h-full items-center gap-2 pl-[82px]">
            <IconButton
              tone="sidebar"
              size="sm"
              onClick={() => setSidebarOpen(false)}
              title="Hide sidebar"
              className="rounded-md"
            >
              <SplitPanel className="size-4" />
            </IconButton>
            <SidebarUpdatePill
              phase={updaterPhase}
              onDownloadUpdate={downloadUpdate}
              onOpenRestartPrompt={openRestartPrompt}
            />
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden">
          <MainSidebar />
        </div>
      </div>

      {sidebarOpen && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-controls="main-sidebar"
          onMouseDown={onLeftSeparatorDown}
          className="relative z-10 flex w-1 shrink-0 cursor-col-resize items-center justify-center -ml-1 hover:bg-primary/30 active:bg-primary/50 transition-colors"
        />
      )}

      <div className={`flex min-w-0 flex-1 flex-col overflow-hidden bg-background ${sidebarOpen ? "rounded-tl-lg" : ""}`}>
        <div className="flex h-10 shrink-0 items-center" data-tauri-drag-region="true">
          {!sidebarOpen && (
            <div className="flex items-center gap-2 pl-[82px] pr-2">
              <IconButton
                size="sm"
                onClick={() => setSidebarOpen(true)}
                title="Show sidebar"
                className="rounded-md"
              >
                <SplitPanel className="size-4" />
              </IconButton>
              <SidebarUpdatePill
                phase={updaterPhase}
                onDownloadUpdate={downloadUpdate}
                onOpenRestartPrompt={openRestartPrompt}
              />
            </div>
          )}
        </div>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className="flex-1 bg-background h-full relative overflow-auto">
            <div className="absolute inset-x-0 top-0 h-10" data-tauri-drag-region="true" />
            <ConnectorCatalogPage />
          </div>
        </div>
      </div>
    </div>
  );
}
