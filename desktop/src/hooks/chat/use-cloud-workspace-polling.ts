import { useEffect } from "react";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useWorkspaces } from "@/hooks/workspaces/use-workspaces";
import { useCloudWorkspaceActions } from "@/hooks/cloud/use-cloud-workspace-actions";
import { useWorkspaceSelection } from "@/hooks/workspaces/selection/use-workspace-selection";
import { buildWorkspaceArrivalEvent } from "@/lib/domain/workspaces/arrival";
import {
  isCloudWorkspacePending,
  shouldShowCloudWorkspaceStatusScreen,
} from "@/lib/domain/workspaces/cloud-workspace-status";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud-ids";
import {
  elapsedMs,
  elapsedSince,
  logLatency,
  startLatencyTimer,
} from "@/lib/infra/debug-latency";

const CLOUD_WORKSPACE_POLL_INTERVAL_MS = 3000;

export function useCloudWorkspacePolling() {
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const pendingWorkspaceEntry = useHarnessStore((state) => state.pendingWorkspaceEntry);
  const setPendingWorkspaceEntry = useHarnessStore((state) => state.setPendingWorkspaceEntry);
  const setWorkspaceArrivalEvent = useHarnessStore((state) => state.setWorkspaceArrivalEvent);
  const { data: workspaceCollections } = useWorkspaces();
  const { refreshCloudWorkspace } = useCloudWorkspaceActions();
  const { selectWorkspace } = useWorkspaceSelection();

  const cloudWorkspaceId = parseCloudWorkspaceSyntheticId(selectedWorkspaceId);
  const cloudWorkspace = workspaceCollections?.cloudWorkspaces.find(
    (workspace) => workspace.id === cloudWorkspaceId,
  ) ?? null;
  const shouldPollCloudWorkspace = Boolean(cloudWorkspace && isCloudWorkspacePending(cloudWorkspace.status));

  useEffect(() => {
    const shouldPauseForFailedPending = pendingWorkspaceEntry?.workspaceId === selectedWorkspaceId
      && pendingWorkspaceEntry.stage === "failed";

    if (
      !selectedWorkspaceId
      || !cloudWorkspaceId
      || !shouldPollCloudWorkspace
      || shouldPauseForFailedPending
    ) {
      return;
    }

    let cancelled = false;
    let timer: number | null = null;
    logLatency("workspace.cloud_polling.start", {
      workspaceId: selectedWorkspaceId,
      status: cloudWorkspace?.status ?? null,
      pendingStage: pendingWorkspaceEntry?.stage ?? null,
      pendingElapsedMs: pendingWorkspaceEntry ? elapsedSince(pendingWorkspaceEntry.createdAt) : null,
    });

    const poll = async () => {
      let shouldScheduleNextPoll = true;
      const pollStartedAt = startLatencyTimer();

      try {
        const workspace = await refreshCloudWorkspace(selectedWorkspaceId);
        logLatency("workspace.cloud_polling.refreshed", {
          workspaceId: selectedWorkspaceId,
          status: workspace.status,
          pollElapsedMs: elapsedMs(pollStartedAt),
          pendingElapsedMs: pendingWorkspaceEntry ? elapsedSince(pendingWorkspaceEntry.createdAt) : null,
        });
        if (cancelled) {
          return;
        }

        if (workspace.status === "ready") {
          shouldScheduleNextPoll = false;
          const pending = useHarnessStore.getState().pendingWorkspaceEntry;
          const shouldPreservePending = pending?.workspaceId === selectedWorkspaceId
            && pending.stage === "awaiting-cloud-ready";

          try {
            await selectWorkspace(selectedWorkspaceId, {
              force: true,
              preservePending: shouldPreservePending,
            });
          } catch (error) {
            if (
              pending
              && pending.workspaceId === selectedWorkspaceId
              && pending.stage !== "failed"
            ) {
              setPendingWorkspaceEntry({
                ...pending,
                stage: "failed",
                request: { kind: "select-existing", workspaceId: selectedWorkspaceId },
                errorMessage: error instanceof Error
                  ? error.message
                  : "Failed to connect the cloud workspace.",
              });
            }
            return;
          }

          const currentPending = useHarnessStore.getState().pendingWorkspaceEntry;
          if (
            currentPending
            && currentPending.workspaceId === selectedWorkspaceId
            && currentPending.stage === "awaiting-cloud-ready"
          ) {
            setPendingWorkspaceEntry(null);
            setWorkspaceArrivalEvent(buildWorkspaceArrivalEvent({
              workspaceId: selectedWorkspaceId,
              source: currentPending.source,
              setupScript: currentPending.setupScript,
              baseBranchName: currentPending.baseBranchName,
            }));
            logLatency("workspace.cloud_polling.ready", {
              workspaceId: selectedWorkspaceId,
              totalElapsedMs: elapsedSince(currentPending.createdAt),
            });
          }
          return;
        }

        if (!shouldShowCloudWorkspaceStatusScreen(workspace)) {
          shouldScheduleNextPoll = false;
        }
      } catch {
        // Keep polling even if a refresh fails.
      } finally {
        if (!cancelled && shouldScheduleNextPoll) {
          timer = window.setTimeout(() => {
            void poll();
          }, CLOUD_WORKSPACE_POLL_INTERVAL_MS);
        }
      }
    };

    void poll();

    return () => {
      cancelled = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [
    cloudWorkspaceId,
    pendingWorkspaceEntry,
    refreshCloudWorkspace,
    selectWorkspace,
    selectedWorkspaceId,
    setPendingWorkspaceEntry,
    setWorkspaceArrivalEvent,
    shouldPollCloudWorkspace,
  ]);
}
