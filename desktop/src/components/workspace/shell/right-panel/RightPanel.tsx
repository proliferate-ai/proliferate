import { useMemo, useState, type ComponentType } from "react";
import { WorkspaceFilesPanel } from "@/components/workspace/files/panel/WorkspaceFilesPanel";
import { GitPanel } from "@/components/workspace/git/GitPanel";
import { TerminalPanel } from "@/components/workspace/terminals/TerminalPanel";
import { SizedPanel } from "@/components/ui/layout/SizedPanel";
import { useResize } from "@/hooks/layout/use-resize";
import { PopoverButton } from "@/components/ui/PopoverButton";
import { IconButton } from "@/components/ui/IconButton";
import { CloudWorkspaceSettingsPanel } from "@/components/cloud/workspace-settings/CloudWorkspaceSettingsPanel";
import {
  ChevronDown,
  FolderList,
  GitBranch,
  MoreHorizontal,
  Settings,
  type IconProps,
} from "@/components/ui/icons";

export type RightPanelMode = "files" | "changes" | "settings";

interface PanelModeConfig {
  id: RightPanelMode;
  label: string;
  icon: ComponentType<IconProps>;
}

const PANEL_MODES: PanelModeConfig[] = [
  { id: "files", label: "Files", icon: FolderList },
  { id: "changes", label: "Changes", icon: GitBranch },
  { id: "settings", label: "Settings", icon: Settings },
];

interface RightPanelProps {
  isWorkspaceReady: boolean;
  shouldKeepContentVisible?: boolean;
  isCloudWorkspaceSelected: boolean;
  mode: RightPanelMode;
  onModeChange: (mode: RightPanelMode) => void;
  terminalCollapsed: boolean;
  onTerminalCollapsedChange: (collapsed: boolean) => void;
  terminalFocusRequestToken: number;
}

export function RightPanel({
  isWorkspaceReady,
  shouldKeepContentVisible = false,
  isCloudWorkspaceSelected,
  mode,
  onModeChange,
  terminalCollapsed,
  onTerminalCollapsedChange,
  terminalFocusRequestToken,
}: RightPanelProps) {
  const [pinnedModes, setPinnedModes] = useState<RightPanelMode[]>([
    "files",
    "changes",
  ]);
  const [terminalHeight, setTerminalHeight] = useState(200);

  const onTerminalSeparatorDown = useResize({
    direction: "vertical",
    size: terminalHeight,
    onResize: setTerminalHeight,
    reverse: true,
    min: 100,
    max: 500,
  });

  const availablePanelModes = useMemo(
    () => PANEL_MODES.filter((panelMode) => panelMode.id !== "settings" || isCloudWorkspaceSelected),
    [isCloudWorkspaceSelected],
  );
  const availableModeIds = useMemo(
    () => new Set(availablePanelModes.map((panelMode) => panelMode.id)),
    [availablePanelModes],
  );
  const activeMode = mode === "settings" && !isCloudWorkspaceSelected ? "files" : mode;
  const visiblePinnedModes = useMemo(
    () => pinnedModes.filter((panelMode) => availableModeIds.has(panelMode)),
    [availableModeIds, pinnedModes],
  );

  const togglePin = (id: RightPanelMode) => {
    setPinnedModes((prev) => {
      if (prev.includes(id)) {
        const visiblePinnedCount = prev.filter((panelMode) => availableModeIds.has(panelMode)).length;
        if (availableModeIds.has(id) && visiblePinnedCount <= 1) {
          return prev;
        }
        return prev.filter((panelMode) => panelMode !== id);
      }
      return [...prev, id];
    });
  };

  const shouldRenderContent = isWorkspaceReady || shouldKeepContentVisible;

  return (
    <div data-group="true" className="flex h-full flex-col rounded-tl-lg overflow-hidden border-l border-t border-border">
      <div
        data-panel="true"
        id="workspace-side-panel"
        className="min-h-[80px] flex-1 overflow-hidden"
      >
        <div className="h-full flex flex-col bg-sidebar-background">
          <div className="flex items-center gap-1 px-2 py-2 border-b border-sidebar-border/70 shrink-0">
            <div className="flex items-center gap-1">
              {visiblePinnedModes.map((id) => {
                const panelMode = availablePanelModes.find((candidate: PanelModeConfig) => candidate.id === id);
                if (!panelMode) {
                  return null;
                }
                const Icon = panelMode.icon;
                const isActive = activeMode === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => onModeChange(id)}
                    aria-label={`Show ${panelMode.label.toLowerCase()} panel`}
                    className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs transition-colors ${
                      isActive
                        ? "text-sidebar-foreground"
                        : "text-sidebar-muted-foreground hover:text-sidebar-foreground"
                    }`}
                  >
                    <Icon className="size-3.5 shrink-0" />
                    <span>{panelMode.label}</span>
                  </button>
                );
              })}
            </div>

            <PopoverButton
              align="end"
              trigger={
                <IconButton size="md" tone="sidebar" title="Panel options">
                  <MoreHorizontal className="size-3.5" />
                </IconButton>
              }
              className="w-44 rounded-md border border-border bg-popover p-1 shadow-floating"
            >
              {() => (
                <div className="flex flex-col gap-px">
                  {availablePanelModes.map((panelMode: PanelModeConfig) => {
                    const Icon = panelMode.icon;
                    const isPinned = pinnedModes.includes(panelMode.id);
                    return (
                      <button
                        key={panelMode.id}
                        type="button"
                        onClick={() => togglePin(panelMode.id)}
                        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      >
                        <Icon className="size-4 shrink-0" />
                        <span className="flex-1 text-left">{panelMode.label}</span>
                        <span className={`text-xs ${isPinned ? "text-foreground" : "text-muted-foreground/50"}`}>
                          {isPinned ? "pinned" : "hidden"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </PopoverButton>
          </div>

          <div className="flex-1 min-h-0 overflow-hidden">
            {!shouldRenderContent ? (
              <RightPanelPlaceholder mode={activeMode} />
            ) : activeMode === "files" ? (
              <WorkspaceFilesPanel showHeader={false} />
            ) : activeMode === "settings" ? (
              <CloudWorkspaceSettingsPanel />
            ) : (
              <GitPanel />
            )}
          </div>
        </div>
      </div>

      {terminalCollapsed ? (
        <TerminalPanel
          collapsed
          onToggleCollapse={() => onTerminalCollapsedChange(false)}
        />
      ) : (
        <>
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-controls="terminal-panel"
            onMouseDown={onTerminalSeparatorDown}
            className="relative flex items-center justify-center h-[3px] shrink-0 cursor-row-resize group hover:bg-primary/30 active:bg-primary/50 transition-colors after:absolute after:inset-x-0 after:top-0 after:h-px after:bg-separator"
          />
            <SizedPanel
              data-panel="true"
              id="terminal-panel"
              className="min-h-0 flex-none overflow-hidden"
              height={terminalHeight}
            >
            {shouldRenderContent ? (
              <TerminalPanel
                isRuntimeReady={isWorkspaceReady}
                onToggleCollapse={() => onTerminalCollapsedChange(true)}
                focusRequestToken={terminalFocusRequestToken}
              />
            ) : (
              <RightPanelTerminalPlaceholder
                onToggleCollapse={() => onTerminalCollapsedChange(true)}
              />
            )}
          </SizedPanel>
        </>
      )}
    </div>
  );
}

function RightPanelPlaceholder({ mode }: { mode: RightPanelMode }) {
  const title = mode === "files"
    ? "Files are getting ready"
    : mode === "changes"
      ? "Git view is getting ready"
      : "Cloud settings are getting ready";
  const description = mode === "files"
    ? "Keep this panel open. The file tree will appear here as soon as the workspace finishes loading."
    : mode === "changes"
      ? "Keep this panel open. Changes and diffs will appear here as soon as the workspace finishes loading."
      : "Keep this panel open. Repo sync status and setup controls will appear here once the cloud workspace finishes loading.";

  return (
    <div className="flex h-full items-center justify-center px-6 text-center">
      <div className="max-w-xs space-y-2">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function RightPanelTerminalPlaceholder({
  onToggleCollapse,
}: {
  onToggleCollapse: () => void;
}) {
  return (
    <div className="flex h-full flex-col border-t border-border bg-background/60" data-telemetry-block>
      <div className="flex items-center gap-1 pr-1 relative overflow-hidden border-b border-border shrink-0">
        <IconButton className="ml-1" onClick={onToggleCollapse} title="Collapse terminal">
          <ChevronDown className="size-4 text-muted-foreground" />
        </IconButton>
        <div className="flex h-8 flex-1 items-center px-2 text-xs text-muted-foreground">
          Terminal
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center px-6 text-center">
        <div className="max-w-xs space-y-2">
          <p className="text-sm font-medium text-foreground">Terminal is getting ready</p>
          <p className="text-sm leading-6 text-muted-foreground">
            The terminal area stays pinned in place and will connect once the workspace is ready.
          </p>
        </div>
      </div>
    </div>
  );
}
