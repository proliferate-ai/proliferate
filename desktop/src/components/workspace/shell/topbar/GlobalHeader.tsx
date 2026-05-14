import {
  memo,
  useState,
  useCallback,
  useEffect,
} from "react";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";
import { resolvePreferredOpenTarget } from "@/lib/domain/chat/composer/preference-resolvers";
import { HeaderTabs } from "@/components/workspace/shell/topbar/HeaderTabs";
import { Button } from "@/components/ui/Button";
import { DebugProfiler } from "@/components/ui/DebugProfiler";
import { SplitButton } from "@/components/workspace/open-target/SplitButton";
import {
  type OpenTarget,
  useTauriShellActions,
} from "@/hooks/access/tauri/use-shell-actions";
import {
  FilePen,
  Play,
  SplitPanel,
} from "@/components/ui/icons";
import type { Workspace } from "@anyharness/sdk";
import { useDebugRenderCount } from "@/hooks/ui/use-debug-render-count";
import { workspaceHeaderTitle } from "@/lib/domain/workspaces/display/workspace-display";

const HEADER_ICON_BUTTON_CLASS =
  "size-7 rounded-lg border border-border bg-background px-0 text-muted-foreground hover:bg-accent hover:text-foreground";
const HEADER_RUN_BUTTON_CLASS =
  "h-7 gap-1.5 rounded-lg border border-border bg-background px-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground";

interface GlobalHeaderProps {
  selectedWorkspace: Workspace | undefined;
  workspacePath?: string | null;
  rightPanelOpen: boolean;
  runDisabled?: boolean;
  runLoading?: boolean;
  runLabel?: string;
  runTitle?: string;
  onRun: () => void;
  onTogglePanel: () => void;
}

export const GlobalHeader = memo(function GlobalHeader({
  selectedWorkspace,
  workspacePath: workspacePathProp,
  rightPanelOpen,
  runDisabled = false,
  runLoading = false,
  runLabel = "Run",
  runTitle = "Run workspace command",
  onRun,
  onTogglePanel,
}: GlobalHeaderProps) {
  useDebugRenderCount("global-header");
  const [targets, setTargets] = useState<OpenTarget[]>([]);
  const {
    listOpenTargets,
    openTarget: execOpenTarget,
  } = useTauriShellActions();
  const defaultOpenInTargetId = useUserPreferencesStore((s) => s.defaultOpenInTargetId);
  const preferredTarget = resolvePreferredOpenTarget(targets, { defaultOpenInTargetId });
  const workspacePath = workspacePathProp ?? selectedWorkspace?.path;
  const title = workspaceHeaderTitle(selectedWorkspace, workspacePath);

  useEffect(() => {
    void listOpenTargets("directory").then(setTargets);
  }, [listOpenTargets]);

  const handleDefaultOpen = useCallback(() => {
    if (!workspacePath) return;
    const targetId = preferredTarget?.id ?? "finder";
    void execOpenTarget(targetId, workspacePath);
  }, [execOpenTarget, workspacePath, preferredTarget]);

  const handleTargetClick = useCallback(
    (targetId: string) => {
      if (!workspacePath) return;
      void execOpenTarget(targetId, workspacePath);
    },
    [execOpenTarget, workspacePath],
  );

  return (
    <DebugProfiler id="global-header">
      <div className="flex h-full min-w-0 flex-1 items-center gap-1.5 px-4">
        <div
          className="min-w-0 max-w-[220px] shrink-0 truncate px-1 text-base font-medium leading-5 text-foreground"
          title={title}
          data-telemetry-mask="true"
        >
          {title}
        </div>

        <div className="flex min-w-0 flex-1 items-center overflow-hidden">
          <HeaderTabs />
        </div>

        <DebugProfiler id="global-header-actions">
          <div className="flex shrink-0 items-center gap-1.5">
            <div className="h-4 w-px bg-border/70" aria-hidden="true" />
            <Button
              variant="secondary"
              size="sm"
              loading={runLoading}
              disabled={runDisabled}
              onClick={onRun}
              aria-label={runTitle}
              title={runTitle}
              className={HEADER_RUN_BUTTON_CLASS}
            >
              <Play className="size-3.5" />
              <span>{runLabel}</span>
            </Button>
            {workspacePath && (
              <SplitButton
                icon={<FilePen className="size-3.5" />}
                label={preferredTarget?.label ?? "Open"}
                showLabel={false}
                onClick={handleDefaultOpen}
                targets={targets}
                onTargetClick={handleTargetClick}
                preferredTarget={preferredTarget}
              />
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={onTogglePanel}
              aria-label={rightPanelOpen ? "Hide side panel" : "Show side panel"}
              title={rightPanelOpen ? "Hide side panel" : "Show side panel"}
              className={HEADER_ICON_BUTTON_CLASS}
            >
              <SplitPanel className="size-3.5" />
            </Button>
          </div>
        </DebugProfiler>
      </div>
    </DebugProfiler>
  );
});
