import { memo, useCallback, useMemo, useRef } from "react";
import type { Workspace } from "@anyharness/sdk";
import type { OpenTarget } from "@proliferate/product-client/host/desktop-bridge";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { DebugProfiler } from "#product/components/diagnostics/DebugProfiler";
import { SplitButton } from "#product/components/workspace/open-target/SplitButton";
import { HeaderTabs } from "#product/components/workspace/shell/topbar/HeaderTabs";
import { WorkspaceActionsMenuContainer } from "#product/components/workspace/shell/topbar/WorkspaceActionsMenuContainer";
import { useDebugRenderCount } from "#product/hooks/ui/debug/use-debug-render-count";
import { useFileReferenceActions } from "#product/hooks/workspaces/workflows/files/use-file-reference-actions";
import { workspaceHeaderTitle } from "#product/lib/domain/workspaces/display/workspace-display";
import { Button } from "#product/primitives/Button";
import { Play } from "#product/primitives/icons/core";
import { FilePen } from "#product/primitives/icons/workspace";
import { useWorkspacePath } from "#product/providers/WorkspacePathProvider";

const HEADER_RUN_BUTTON_CLASS = "workspace-shell-action-button font-medium";
const COPY_PATH_TARGET: OpenTarget = {
  id: "copy-path",
  label: "Copy path",
  kind: "copy",
};

interface GlobalHeaderProps {
  selectedWorkspace: Workspace | undefined;
  /** Inventory/pending path used only to derive the visible workspace title. */
  displayWorkspacePath?: string | null;
  runDisabled?: boolean;
  runLoading?: boolean;
  runLabel?: string;
  runTitle?: string;
  onRun: () => void;
}

export const GlobalHeader = memo(function GlobalHeader({
  selectedWorkspace,
  displayWorkspacePath,
  runDisabled = false,
  runLoading = false,
  runLabel = "Run",
  runTitle = "Run workspace command",
  onRun,
}: GlobalHeaderProps) {
  useDebugRenderCount("global-header");
  const host = useProductHost();
  const workspacePathState = useWorkspacePath();
  const rootActions = useFileReferenceActions({
    rawPath: ".",
    workspacePath: ".",
    nativeCapabilityKind: "directory",
  });
  const rootLocator = rootActions.accessState.status === "settled"
    && rootActions.accessState.locator.authority === "workspace"
    ? rootActions.accessState.locator
    : null;
  const rootCapabilityAvailable = rootActions.accessState.status === "settled"
    && rootActions.accessState.kind === "directory"
    && rootLocator?.workspacePath === ""
    && rootLocator.localCompanionPath !== null
    && rootActions.nativePathKind === "directory";
  const targets = useMemo(
    () => rootCapabilityAvailable
      ? [...rootActions.openTargets, COPY_PATH_TARGET]
      : [],
    [rootActions.openTargets, rootCapabilityAvailable],
  );
  const preferredTarget = rootActions.defaultOpenTarget;

  const capabilityRevision = useMemo(() => ({}), [
    host.desktop?.files,
    rootActions.nativePathKind,
    rootActions.openDefault,
    rootLocator?.localCompanionPath,
    rootLocator?.workspacePath,
    rootCapabilityAvailable,
    workspacePathState.filesystemOrigin.origin,
    workspacePathState.filesystemOrigin.status,
    workspacePathState.materializedWorkspaceId,
    workspacePathState.workspaceRoot.path,
    workspacePathState.workspaceRoot.status,
  ]);
  const capabilityRef = useRef({
    actions: rootActions,
    available: rootCapabilityAvailable,
    revision: capabilityRevision,
    targets,
    preferredTarget,
  });
  capabilityRef.current = {
    actions: rootActions,
    available: rootCapabilityAvailable,
    revision: capabilityRevision,
    targets,
    preferredTarget,
  };

  const handleDefaultOpen = useCallback(() => {
    const current = capabilityRef.current;
    if (!current.available || current.revision !== capabilityRevision) return;
    if (current.preferredTarget) {
      void current.actions.openDefault();
      return;
    }
    void current.actions.reveal();
  }, [capabilityRevision]);

  const handleTargetClick = useCallback((target: OpenTarget) => {
    const current = capabilityRef.current;
    if (
      !current.available
      || current.revision !== capabilityRevision
      || !current.targets.some((candidate) => candidate.id === target.id)
    ) return;
    if (target.kind === "copy") {
      void current.actions.copyCurrentPath();
      return;
    }
    void current.actions.openWithTarget(target.id);
  }, [capabilityRevision]);

  // This inventory-derived value is deliberately display-only. Filesystem
  // actions above use the authority-proven runtime root capability instead.
  const titlePath = displayWorkspacePath ?? selectedWorkspace?.path;
  const title = workspaceHeaderTitle(selectedWorkspace, titlePath);

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
            {rootCapabilityAvailable && (
              <SplitButton
                icon={<FilePen className="icon-paired" />}
                label={preferredTarget?.label ?? "Reveal in Finder"}
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
