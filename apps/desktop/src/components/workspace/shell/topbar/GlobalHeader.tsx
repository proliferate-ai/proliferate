import {
  memo,
  useState,
  useCallback,
  useEffect,
} from "react";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";
import { resolvePreferredOpenTarget } from "@/lib/domain/chat/composer/preference-resolvers";
import { HeaderTabs } from "@/components/workspace/shell/topbar/HeaderTabs";
import { WorkspaceActionsMenuContainer } from "@/components/workspace/shell/topbar/WorkspaceActionsMenuContainer";
import { Button } from "@proliferate/ui/primitives/Button";
import { DebugProfiler } from "@/components/diagnostics/DebugProfiler";
import { SplitButton } from "@/components/workspace/open-target/SplitButton";
import {
  type OpenTarget,
} from "@proliferate/product-client/host/desktop-bridge";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import {
  FilePen,
  Play,
  SplitPanel,
} from "@proliferate/ui/icons";
import type { Workspace } from "@anyharness/sdk";
import { useDebugRenderCount } from "@/hooks/ui/debug/use-debug-render-count";
import { workspaceHeaderTitle } from "@/lib/domain/workspaces/display/workspace-display";

const HEADER_ICON_BUTTON_CLASS = "workspace-shell-icon-button";
const HEADER_RUN_BUTTON_CLASS = "workspace-shell-action-button font-medium";

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
  const host = useProductHost();
  const files = host.desktop?.files ?? null;
  const defaultOpenInTargetId = useUserPreferencesStore((s) => s.defaultOpenInTargetId);
  const preferredTarget = resolvePreferredOpenTarget(targets, { defaultOpenInTargetId });
  const workspacePath = workspacePathProp ?? selectedWorkspace?.path;
  const title = workspaceHeaderTitle(selectedWorkspace, workspacePath);

  useEffect(() => {
    if (!files) {
      setTargets([]);
      return;
    }
    void files.listOpenTargets("directory").then(setTargets);
  }, [files]);

  const handleDefaultOpen = useCallback(() => {
    if (!workspacePath) return;
    if (!files) return;
    if (preferredTarget?.kind === "copy") {
      void host.clipboard.writeText(workspacePath);
      return;
    }
    void files.openTarget(preferredTarget?.id ?? "finder", workspacePath);
  }, [files, host.clipboard, workspacePath, preferredTarget]);

  const handleTargetClick = useCallback(
    (target: OpenTarget) => {
      if (!workspacePath) return;
      if (!files) return;
      if (target.kind === "copy") {
        void host.clipboard.writeText(workspacePath);
        return;
      }
      void files.openTarget(target.id, workspacePath);
    },
    [files, host.clipboard, workspacePath],
  );

  return (
    <DebugProfiler id="global-header">
      <div className="flex h-full min-w-0 flex-1 items-center gap-1 px-2">
        <div
          className="min-w-0 max-w-[220px] shrink-0 truncate px-1.5 text-ui font-medium text-foreground"
          title={title}
          data-telemetry-mask="true"
        >
          {title}
        </div>

        <WorkspaceActionsMenuContainer />

        <div className="flex min-w-0 flex-1 items-center overflow-hidden">
          <HeaderTabs />
        </div>

        <DebugProfiler id="global-header-actions">
          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              variant="ghost"
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
            {workspacePath && files && (
              <SplitButton
                icon={<FilePen className="size-4" />}
                label={preferredTarget?.label ?? "Open"}
                showLabel={false}
                onClick={handleDefaultOpen}
                targets={targets}
                onTargetClick={handleTargetClick}
                preferredTarget={preferredTarget}
              />
            )}
            {!rightPanelOpen && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onTogglePanel}
                aria-label="Toggle side panel"
                title="Toggle side panel"
                className={HEADER_ICON_BUTTON_CLASS}
              >
                <SplitPanel className="size-3.5" />
              </Button>
            )}
          </div>
        </DebugProfiler>
      </div>
    </DebugProfiler>
  );
});
