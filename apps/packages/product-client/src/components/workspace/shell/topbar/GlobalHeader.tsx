import {
  memo,
  useState,
  useCallback,
  useEffect,
} from "react";
import { useUserPreferencesStore } from "#product/stores/preferences/user-preferences-store";
import { resolvePreferredOpenTarget } from "#product/lib/domain/chat/composer/preference-resolvers";
import { HeaderTabs } from "#product/components/workspace/shell/topbar/HeaderTabs";
import { WorkspaceActionsMenuContainer } from "#product/components/workspace/shell/topbar/WorkspaceActionsMenuContainer";
import { Button } from "#product/primitives/Button";
import { DebugProfiler } from "#product/components/diagnostics/DebugProfiler";
import { SplitButton } from "#product/components/workspace/open-target/SplitButton";
import {
  type OpenTarget,
} from "@proliferate/product-client/host/desktop-bridge";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { FilePen } from "#product/primitives/icons/workspace";
import { Play } from "#product/primitives/icons/core";
import type { Workspace } from "@anyharness/sdk";
import { useDebugRenderCount } from "#product/hooks/ui/debug/use-debug-render-count";
import { workspaceHeaderTitle } from "#product/lib/domain/workspaces/display/workspace-display";
import { useToastStore } from "#product/stores/toast/toast-store";

const HEADER_RUN_BUTTON_CLASS = "workspace-shell-action-button font-medium";

interface GlobalHeaderProps {
  selectedWorkspace: Workspace | undefined;
  workspacePath?: string | null;
  runDisabled?: boolean;
  runLoading?: boolean;
  runLabel?: string;
  runTitle?: string;
  onRun: () => void;
}

export const GlobalHeader = memo(function GlobalHeader({
  selectedWorkspace,
  workspacePath: workspacePathProp,
  runDisabled = false,
  runLoading = false,
  runLabel = "Run",
  runTitle = "Run workspace command",
  onRun,
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

  const showToast = useToastStore((s) => s.show);

  const openTarget = useCallback(
    (targetId: string, label: string) => {
      if (!workspacePath || !files) return;
      // The Rust side re-resolves the app at click time, so an editor can
      // vanish between listing and clicking — don't swallow that.
      files.openTarget(targetId, workspacePath).catch(() => {
        showToast(`Couldn't open workspace in ${label}`);
      });
    },
    [files, showToast, workspacePath],
  );

  const handleDefaultOpen = useCallback(() => {
    if (!workspacePath) return;
    if (preferredTarget?.kind === "copy") {
      void host.clipboard.writeText(workspacePath);
      return;
    }
    openTarget(preferredTarget?.id ?? "finder", preferredTarget?.label ?? "Finder");
  }, [host.clipboard, openTarget, workspacePath, preferredTarget]);

  const handleTargetClick = useCallback(
    (target: OpenTarget) => {
      if (!workspacePath) return;
      if (target.kind === "copy") {
        void host.clipboard.writeText(workspacePath);
        return;
      }
      openTarget(target.id, target.label);
    },
    [host.clipboard, openTarget, workspacePath],
  );

  return (
    <DebugProfiler id="global-header">
      <div
        className="flex h-full min-w-0 flex-1 items-center gap-1 pr-2 transition-[padding-left] ease-out-cubic [transition-duration:var(--workspace-left-geometry-duration)]"
        style={{
          paddingLeft: "max(8px, calc(var(--workspace-left-header-dwell) - var(--workspace-left-width)))",
        }}
      >
        <div
          className="min-w-0 max-w-[220px] shrink-0 truncate px-1.5 font-medium text-foreground"
          style={{
            fontSize: "var(--text-workspace-title)",
            lineHeight: "var(--text-workspace-title--line-height)",
          }}
          title={title}
          data-telemetry-mask="true"
        >
          {title}
        </div>

        <WorkspaceActionsMenuContainer />

        <div className="flex h-full min-w-0 flex-1 items-stretch overflow-hidden">
          <HeaderTabs />
        </div>

        <DebugProfiler id="global-header-actions">
          <div
            className="flex shrink-0 items-center gap-1.5 transition-[padding-right] ease-out-cubic [transition-duration:var(--workspace-right-geometry-duration)]"
            style={{
              paddingRight: "max(0px, calc(36px - var(--workspace-right-width)))",
            }}
          >
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
              <Play className="icon-paired" />
              <span>{runLabel}</span>
            </Button>
            {workspacePath && files && (
              <SplitButton
                icon={<FilePen className="icon-paired" />}
                label={preferredTarget?.label ?? "Open"}
                showLabel={false}
                onClick={handleDefaultOpen}
                targets={targets}
                onTargetClick={handleTargetClick}
                preferredTarget={preferredTarget}
              />
            )}
          </div>
        </DebugProfiler>
      </div>
    </DebugProfiler>
  );
});
