import { useMemo, useState } from "react";
import { Button } from "#product/primitives/Button";
import { Badge } from "#product/primitives/Badge";
import {
  ComposerAttachedPanel,
  ComposerAttachedPanelRow,
} from "#product/components/workspace/chat/input/ComposerAttachedPanel";
import { WorkspaceArrivalCloudPanel } from "#product/components/workspace/chat/surface/WorkspaceArrivalCloudPanel";
import { WorktreeMissingAttachedPanel } from "#product/components/workspace/chat/surface/WorktreeMissingAttachedPanel";
import { useWorkspaceStatusPanelState } from "#product/hooks/workspaces/derived/use-workspace-status-panel-state";
import { usePendingWorkspaceEntryActions } from "#product/hooks/workspaces/workflows/use-pending-workspace-entry-actions";
import { useCloudWorkspaceStatusScreenActions } from "#product/hooks/cloud/workflows/use-cloud-workspace-status-screen-actions";
import { useDeferredHomeLaunchStore } from "#product/stores/home/deferred-home-launch-store";
import { Spinner } from "#product/primitives/Spinner";

export function WorkspaceArrivalAttachedPanel() {
  const panelState = useWorkspaceStatusPanelState();
  const [expanded, setExpanded] = useState(true);
  const { handleRetry, handleBack } = usePendingWorkspaceEntryActions();
  const deferredLaunchesById = useDeferredHomeLaunchStore((state) => state.launches);
  const deferredWorkspaceId = panelState?.kind === "pending"
    ? panelState.entry.workspaceId
    : panelState?.kind === "cloud-status"
      ? panelState.workspaceId
      : null;
  const deferredPromptCount = useMemo(() => {
    if (!deferredWorkspaceId) {
      return 0;
    }
    return Object.values(deferredLaunchesById).filter(
      (launch) => launch.workspaceId === deferredWorkspaceId,
    ).length;
  }, [deferredLaunchesById, deferredWorkspaceId]);

  const cloudActions = useCloudWorkspaceStatusScreenActions({
    workspaceId: panelState?.kind === "cloud-status" ? panelState.workspaceId : "",
    mode: panelState?.kind === "cloud-status" ? panelState.model.mode : "pending",
  });

  if (!panelState) {
    return null;
  }

  if (panelState.kind === "directory-missing") {
    return (
      <WorktreeMissingAttachedPanel
        workspaceId={panelState.workspaceId}
        logicalWorkspaceId={panelState.logicalWorkspaceId}
        workspaceKind={panelState.workspaceKind}
        workspacePath={panelState.workspacePath}
        currentBranch={panelState.currentBranch}
        restoreEligible={panelState.restoreEligible}
      />
    );
  }

  if (panelState.kind === "pending") {
    const isBusy = !panelState.isFailed;

    return (
      <ComposerAttachedPanel
        header={(
          <>
            <Badge className="shrink-0 rounded-full px-2 py-0.5 text-chat">
              <span className="inline-flex items-center gap-1">
                {isBusy && <Spinner className="icon-compact" />}
                <span>{panelState.badgeLabel}</span>
              </span>
            </Badge>
            <span className="min-w-0 truncate text-chat font-medium text-foreground">
              {panelState.title}
            </span>
            <span className="truncate text-chat text-muted-foreground">
              {panelState.subtitle}
            </span>
          </>
        )}
        expanded={expanded}
        onToggleExpanded={() => setExpanded((v) => !v)}
      >
        <div className="max-h-[min(32vh,280px)] overflow-y-auto">
          {panelState.detail && (
            <ComposerAttachedPanelRow label="Details">
              <span className="truncate text-chat text-muted-foreground">
                {panelState.detail}
              </span>
            </ComposerAttachedPanelRow>
          )}

          {deferredPromptCount > 0 ? (
            <ComposerAttachedPanelRow label="Prompt">
              <span className="truncate text-chat text-muted-foreground">
                Queued prompt will send when this cloud workspace is ready.
              </span>
            </ComposerAttachedPanelRow>
          ) : null}

          {panelState.isFailed && (
            <ComposerAttachedPanelRow label="Actions">
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void handleBack(panelState.entry);
                  }}
                >
                  Back
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    void handleRetry(panelState.entry);
                  }}
                >
                  Retry
                </Button>
              </div>
            </ComposerAttachedPanelRow>
          )}
        </div>
      </ComposerAttachedPanel>
    );
  }

  const { model } = panelState;
  return (
    <WorkspaceArrivalCloudPanel
      model={model}
      isPrimaryActionPending={cloudActions.isPrimaryActionPending}
      onPrimaryAction={cloudActions.handlePrimaryAction}
      pendingPromptCount={deferredPromptCount}
    />
  );
}
