import type { ReactNode } from "react";
import { IconButton } from "@proliferate/ui/primitives/IconButton";
import { SplitPanelLeft } from "@proliferate/ui/icons";
import { useResize } from "@/hooks/ui/layout/use-resize";
import { useTransparentChromeEnabled } from "@/hooks/theme/derived/use-transparent-chrome";
import { useUpdater } from "@/hooks/access/tauri/use-updater";
import { resolveStandardWorkspaceChromeClasses } from "@/lib/domain/preferences/workspace-chrome";
import {
  WORKSPACE_SIDEBAR_MAX_WIDTH,
  WORKSPACE_SIDEBAR_MIN_WIDTH,
} from "@/lib/domain/preferences/workspace-ui/sidebar";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import { SidebarUpdatePill } from "@/components/workspace/shell/sidebar/SidebarUpdatePill";
import { MainSidebar } from "@/components/workspace/shell/sidebar/MainSidebar";

interface MainSidebarPageShellProps {
  children: ReactNode;
}

export function MainSidebarPageShell({ children }: MainSidebarPageShellProps) {
  const sidebarOpen = useWorkspaceUiStore((s) => s.sidebarOpen);
  const sidebarWidth = useWorkspaceUiStore((s) => s.sidebarWidth);
  const setSidebarOpen = useWorkspaceUiStore((s) => s.setSidebarOpen);
  const setSidebarWidth = useWorkspaceUiStore((s) => s.setSidebarWidth);
  const transparentChromeEnabled = useTransparentChromeEnabled();
  const chromeClasses = resolveStandardWorkspaceChromeClasses({
    transparent: transparentChromeEnabled,
    sidebarOpen,
    showHeaderDivider: false,
    showContentTopBorder: false,
  });
  const {
    phase: updaterPhase,
    downloadProgress,
    restartWhenIdle,
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
    <div
      className={`flex h-screen overflow-hidden ${chromeClasses.root}`}
      data-telemetry-block
    >
      <div
        id="main-sidebar"
        className="flex shrink-0 flex-col overflow-hidden bg-sidebar transition-[width] duration-150 ease-in-out"
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
              <SplitPanelLeft className="size-4" />
            </IconButton>
            {/* The update pill's single home is the top-left, next to the
                sidebar toggle. */}
            <SidebarUpdatePill
              phase={updaterPhase}
              downloadProgress={downloadProgress}
              restartWhenIdle={restartWhenIdle}
              onDownloadUpdate={downloadUpdate}
              onOpenRestartPrompt={openRestartPrompt}
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <MainSidebar />
        </div>
      </div>

      {sidebarOpen && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-controls="main-sidebar"
          onMouseDown={onLeftSeparatorDown}
          className="relative z-10 -ml-1 flex w-1 shrink-0 cursor-col-resize items-center justify-center transition-colors hover:bg-primary/30 active:bg-primary/50"
        />
      )}

      <div
        className={`relative flex min-w-0 flex-1 flex-col overflow-hidden ${chromeClasses.contentShell}`}
      >
        <div
          className="absolute left-0 right-0 top-0 z-20 h-10"
          data-tauri-drag-region="true"
        >
          {!sidebarOpen && (
            <div className="flex h-full items-center gap-2 pl-[82px] pr-2">
              <IconButton
                size="sm"
                onClick={() => setSidebarOpen(true)}
                title="Show sidebar"
                className="rounded-md"
              >
                <SplitPanelLeft className="size-4" />
              </IconButton>
              <SidebarUpdatePill
                phase={updaterPhase}
                downloadProgress={downloadProgress}
                restartWhenIdle={restartWhenIdle}
                onDownloadUpdate={downloadUpdate}
                onOpenRestartPrompt={openRestartPrompt}
              />
            </div>
          )}
        </div>

        <div className="flex min-h-0 flex-1 overflow-hidden bg-sidebar-background">
          {children}
        </div>
      </div>
    </div>
  );
}
