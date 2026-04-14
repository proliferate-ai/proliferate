import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { ChatView } from "@/components/workspace/chat/ChatView";
import { MainSidebar } from "@/components/workspace/shell/sidebar/MainSidebar";
import { SidebarUpdatePill } from "@/components/workspace/shell/SidebarUpdatePill";
import { IconButton } from "@/components/ui/IconButton";
import { SplitPanel } from "@/components/ui/icons";
import { CoworkArtifactsPanel } from "@/components/workspace/cowork/CoworkArtifactsPanel";
import { CoworkWorkspaceHeader } from "@/components/workspace/cowork/CoworkWorkspaceHeader";
import { useResize } from "@/hooks/layout/use-resize";
import { useTransparentChromeEnabled } from "@/hooks/theme/use-transparent-chrome";
import { useUpdater } from "@/hooks/updater/use-updater";
import {
  useWorkspaceUiStore,
  WORKSPACE_SIDEBAR_MAX_WIDTH,
  WORKSPACE_SIDEBAR_MIN_WIDTH,
} from "@/stores/preferences/workspace-ui-store";
import { useCoworkUiStore } from "@/stores/cowork/cowork-ui-store";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { WorkspacePathProvider } from "@/providers/WorkspacePathProvider";

interface CoworkWorkspaceShellProps {
  workspaceId: string | null;
  workspacePath: string | null;
  fallbackTitle?: string | null;
}

const GLASS_HEADER_CLASS =
  "flex h-10 shrink-0 items-center border-b border-foreground/10 bg-card/30 backdrop-blur-xl supports-[backdrop-filter]:bg-card/20";
const SOLID_HEADER_CLASS = "flex h-10 shrink-0 items-center";

export function CoworkWorkspaceShell({
  workspaceId,
  workspacePath,
  fallbackTitle,
}: CoworkWorkspaceShellProps) {
  // Cowork keeps its artifact pane width session-local until the shell chrome
  // is extracted and shares the standard workspace frame state.
  const [rightPanelWidth, setRightPanelWidth] = useState(420);
  const {
    sidebarOpen,
    setSidebarOpen,
    sidebarWidth,
    setSidebarWidth,
  } = useWorkspaceUiStore(useShallow((state) => ({
    sidebarOpen: state.sidebarOpen,
    setSidebarOpen: state.setSidebarOpen,
    sidebarWidth: state.sidebarWidth,
    setSidebarWidth: state.setSidebarWidth,
  })));
  const canShowArtifactPanel = workspaceId !== null;
  const rightPanelOpen = useCoworkUiStore(
    (state) => (workspaceId ? state.artifactPanelOpenByWorkspaceId[workspaceId] === true : false),
  );
  const setArtifactPanelOpen = useCoworkUiStore((state) => state.setArtifactPanelOpen);
  const transparentChromeEnabled = useTransparentChromeEnabled();
  const {
    activeSessionId,
    activeSlot,
  } = useHarnessStore(useShallow((state) => ({
    activeSessionId: state.activeSessionId,
    activeSlot: state.activeSessionId ? state.sessionSlots[state.activeSessionId] ?? null : null,
  })));
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
  const onRightSeparatorDown = useResize({
    direction: "horizontal",
    size: rightPanelWidth,
    onResize: setRightPanelWidth,
    reverse: true,
    min: 280,
    max: 760,
  });

  const headerTitle = useMemo(() => {
    if (workspaceId && activeSessionId && activeSlot?.workspaceId === workspaceId && activeSlot.title?.trim()) {
      return activeSlot.title.trim();
    }
    return fallbackTitle?.trim() || "Untitled chat";
  }, [activeSessionId, activeSlot?.title, activeSlot?.workspaceId, fallbackTitle, workspaceId]);

  return (
    <WorkspacePathProvider workspacePath={workspacePath}>
      <div
        className={`h-screen flex overflow-hidden ${
          transparentChromeEnabled ? "bg-transparent" : "bg-sidebar"
        }`}
        data-telemetry-block
      >
        <div
          id="cowork-sidebar"
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
            aria-controls="cowork-sidebar"
            onMouseDown={onLeftSeparatorDown}
            className="relative z-10 flex w-1 shrink-0 cursor-col-resize items-center justify-center -ml-1 hover:bg-primary/30 active:bg-primary/50 transition-colors"
          />
        )}

        <div
          className={`flex min-w-0 flex-1 flex-col overflow-hidden ${
            transparentChromeEnabled ? "bg-transparent" : "bg-background"
          } ${sidebarOpen ? "rounded-tl-lg" : ""}`}
        >
          <div
            className={transparentChromeEnabled ? GLASS_HEADER_CLASS : SOLID_HEADER_CLASS}
            data-tauri-drag-region="true"
          >
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
            <CoworkWorkspaceHeader
              title={headerTitle}
              sidebarOpen={sidebarOpen}
              rightPanelOpen={rightPanelOpen}
              showArtifactsToggle={canShowArtifactPanel}
              onToggleSidebar={() => setSidebarOpen((value) => !value)}
              onToggleRightPanel={() => {
                if (!workspaceId) {
                  return;
                }
                setArtifactPanelOpen(workspaceId, !rightPanelOpen);
              }}
            />
          </div>

          <div className="flex min-h-0 flex-1 overflow-hidden bg-background">
            <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 top-0 z-10 h-6 bg-gradient-to-b from-background to-transparent"
              />
              <ChatView />
            </div>

            {canShowArtifactPanel && rightPanelOpen && (
              <div
                role="separator"
                aria-orientation="vertical"
                onMouseDown={onRightSeparatorDown}
                className="relative z-10 flex w-1 shrink-0 cursor-col-resize items-center justify-center -mr-1 hover:bg-primary/30 active:bg-primary/50 transition-colors"
              />
            )}

            <div
              className="shrink-0 overflow-hidden transition-[width] duration-150 ease-in-out"
              style={{ width: canShowArtifactPanel && rightPanelOpen ? rightPanelWidth : 0 }}
            >
              <div className="h-full" style={{ minWidth: 320 }}>
                {workspaceId ? <CoworkArtifactsPanel workspaceId={workspaceId} /> : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </WorkspacePathProvider>
  );
}
