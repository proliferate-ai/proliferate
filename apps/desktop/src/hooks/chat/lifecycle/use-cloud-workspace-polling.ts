import { useEffect } from "react";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useWorkspaces } from "@/hooks/workspaces/cache/use-workspaces";
import { useCloudWorkspaceActions } from "@/hooks/cloud/workflows/use-cloud-workspace-actions";
import { useWorkspaceSelection } from "@/hooks/workspaces/workflows/selection/use-workspace-selection";
import { buildWorkspaceArrivalEvent } from "@/lib/domain/workspaces/creation/arrival";
import {
  usePendingWorkspaceSessionMaterialization,
} from "@/hooks/workspaces/workflows/use-pending-workspace-session-materialization";
import {
  resolveActiveProjectedSessionForPendingWorkspace,
} from "@/hooks/workspaces/workflows/pending-workspace-projected-session";
import {
  isCloudWorkspacePostReadyPending,
  resolveCloudWorkspaceStatus,
  shouldPollCloudWorkspaceForUpdates,
  shouldShowCloudWorkspaceStatusScreen,
} from "@/lib/domain/workspaces/cloud/cloud-workspace-status";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";
import { trackWorkspaceInteraction } from "@/stores/preferences/workspace-ui-store";
import {
  elapsedMs,
  elapsedSince,
  logLatency,
  startLatencyTimer,
} from "@/lib/infra/measurement/debug-latency";

const CLOUD_WORKSPACE_POLL_INTERVAL_MS = 3000;

/**
 * Client-side deadline for materialization polling. If a workspace has been in
 * a pending/materializing state for longer than this duration (measured from
 * the pending entry createdAt timestamp), the poller will treat it as stalled
 * and surface an error regardless of what the server still reports. This is a
 * belt-and-suspenders guard against infinite spinners — the server itself will
 * report materialization_stalled after 15 min, but the client enforces a
 * matching deadline in case network issues delay that signal.
 */
const CLIENT_MATERIALIZATION_DEADLINE_MS = 16 * 60 * 1000; // 16 minutes

export function useCloudWorkspacePolling() {
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const pendingWorkspaceEntry = useSessionSelectionStore((state) => state.pendingWorkspaceEntry);
  const setPendingWorkspaceEntry = useSessionSelectionStore((state) => state.setPendingWorkspaceEntry);
  const setWorkspaceArrivalEvent = useSessionSelectionStore((state) => state.setWorkspaceArrivalEvent);
  const { data: workspaceCollections } = useWorkspaces();
  const { refreshCloudWorkspace } = useCloudWorkspaceActions();
  const { selectWorkspace } = useWorkspaceSelection();
  const materializePendingWorkspaceSessions = usePendingWorkspaceSessionMaterialization();

  const cloudWorkspaceId = parseCloudWorkspaceSyntheticId(selectedWorkspaceId);
  const cloudWorkspace = workspaceCollections?.cloudWorkspaces.find(
    (workspace) => workspace.id === cloudWorkspaceId,
  ) ?? null;
  const cloudWorkspaceStatus = resolveCloudWorkspaceStatus(cloudWorkspace);
  const selectedPendingCloudWorkspaceIsAwaiting = pendingWorkspaceEntry?.workspaceId === selectedWorkspaceId
    && pendingWorkspaceEntry.stage === "awaiting-cloud-ready";
  const shouldHandleCachedCloudWorkspaceFailure = Boolean(
    cloudWorkspace
    && cloudWorkspaceStatus === "error"
    && selectedPendingCloudWorkspaceIsAwaiting,
  );
  const shouldHandleCachedCloudWorkspaceReady = Boolean(
    cloudWorkspace
    && cloudWorkspaceStatus === "ready"
    && !isCloudWorkspacePostReadyPending(cloudWorkspace)
    && selectedPendingCloudWorkspaceIsAwaiting,
  );
  const shouldPollCloudWorkspace = Boolean(
    cloudWorkspace
    && (
      shouldPollCloudWorkspaceForUpdates(cloudWorkspace)
      || shouldHandleCachedCloudWorkspaceFailure
      || shouldHandleCachedCloudWorkspaceReady
    ),
  );

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
      status: cloudWorkspaceStatus,
      pendingStage: pendingWorkspaceEntry?.stage ?? null,
      pendingElapsedMs: pendingWorkspaceEntry ? elapsedSince(pendingWorkspaceEntry.createdAt) : null,
    });

    if (shouldHandleCachedCloudWorkspaceFailure && cloudWorkspace && pendingWorkspaceEntry) {
      setPendingWorkspaceEntry({
        ...pendingWorkspaceEntry,
        stage: "failed",
        request: { kind: "select-existing", workspaceId: selectedWorkspaceId },
        errorMessage: cloudWorkspace.lastError
          ?? cloudWorkspace.statusDetail
          ?? "Cloud workspace provisioning failed.",
      });
      logLatency("workspace.cloud_polling.failed", {
        workspaceId: selectedWorkspaceId,
        pendingAttemptId: pendingWorkspaceEntry.attemptId,
        errorMessage: cloudWorkspace.lastError ?? cloudWorkspace.statusDetail ?? null,
      });
      return;
    }

    const poll = async () => {
      let shouldScheduleNextPoll = true;
      const pollStartedAt = startLatencyTimer();

      try {
        const workspace = await refreshCloudWorkspace(selectedWorkspaceId);
        const refreshedStatus = resolveCloudWorkspaceStatus(workspace);
        logLatency("workspace.cloud_polling.refreshed", {
          workspaceId: selectedWorkspaceId,
          status: refreshedStatus,
          pollElapsedMs: elapsedMs(pollStartedAt),
          pendingElapsedMs: pendingWorkspaceEntry ? elapsedSince(pendingWorkspaceEntry.createdAt) : null,
        });
        if (cancelled) {
          return;
        }

        // Client-side staleness deadline: if we have been polling for longer
        // than CLIENT_MATERIALIZATION_DEADLINE_MS and the workspace is still
        // not ready, treat it as failed regardless of server status.
        const pendingElapsed = pendingWorkspaceEntry
          ? elapsedSince(pendingWorkspaceEntry.createdAt)
          : null;
        if (
          refreshedStatus !== "ready"
          && refreshedStatus !== "error"
          && pendingElapsed != null
          && pendingElapsed > CLIENT_MATERIALIZATION_DEADLINE_MS
        ) {
          shouldScheduleNextPoll = false;
          const pending = useSessionSelectionStore.getState().pendingWorkspaceEntry;
          if (
            pending
            && pending.workspaceId === selectedWorkspaceId
            && pending.stage === "awaiting-cloud-ready"
          ) {
            setPendingWorkspaceEntry({
              ...pending,
              stage: "failed",
              request: { kind: "select-existing", workspaceId: selectedWorkspaceId },
              errorMessage:
                "Workspace provisioning timed out. Delete this workspace and try again.",
            });
          }
          logLatency("workspace.cloud_polling.client_deadline_exceeded", {
            workspaceId: selectedWorkspaceId,
            pendingAttemptId: pending?.attemptId ?? null,
            pendingElapsedMs: pendingElapsed,
          });
          return;
        }

        if (refreshedStatus === "error") {
          shouldScheduleNextPoll = false;
          const pending = useSessionSelectionStore.getState().pendingWorkspaceEntry;
          if (
            pending
            && pending.workspaceId === selectedWorkspaceId
            && pending.stage === "awaiting-cloud-ready"
          ) {
            setPendingWorkspaceEntry({
              ...pending,
              stage: "failed",
              request: { kind: "select-existing", workspaceId: selectedWorkspaceId },
              errorMessage: workspace.lastError
                ?? workspace.statusDetail
                ?? "Cloud workspace provisioning failed.",
            });
          }
          logLatency("workspace.cloud_polling.failed", {
            workspaceId: selectedWorkspaceId,
            pendingAttemptId: pending?.attemptId ?? null,
            errorMessage: workspace.lastError ?? workspace.statusDetail ?? null,
          });
          return;
        }

        if (refreshedStatus === "ready" && !isCloudWorkspacePostReadyPending(workspace)) {
          shouldScheduleNextPoll = false;
          const pending = useSessionSelectionStore.getState().pendingWorkspaceEntry;
          const shouldPreservePending = pending?.workspaceId === selectedWorkspaceId
            && pending.stage === "awaiting-cloud-ready";
          const initialActiveSessionId = shouldPreservePending
            ? resolveActiveProjectedSessionForPendingWorkspace(selectedWorkspaceId, pending)
            : null;
          logLatency("workspace.cloud_polling.ready_selection.start", {
            workspaceId: selectedWorkspaceId,
            pendingAttemptId: pending?.attemptId ?? null,
            shouldPreservePending,
            initialActiveSessionId,
          });

          try {
            await selectWorkspace(selectedWorkspaceId, {
              force: true,
              preservePending: shouldPreservePending,
              ...(initialActiveSessionId ? { initialActiveSessionId } : {}),
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
            logLatency("workspace.cloud_polling.ready_selection.failed", {
              workspaceId: selectedWorkspaceId,
              pendingAttemptId: pending?.attemptId ?? null,
              errorMessage: error instanceof Error ? error.message : String(error),
            });
            return;
          }

          const currentPending = useSessionSelectionStore.getState().pendingWorkspaceEntry;
          if (
            currentPending
            && currentPending.workspaceId === selectedWorkspaceId
            && currentPending.stage === "awaiting-cloud-ready"
          ) {
            const projectedSessionMaterialization = materializePendingWorkspaceSessions(
              currentPending,
              selectedWorkspaceId,
              { eventPrefix: "workspace.cloud_polling" },
            );
            trackWorkspaceInteraction(selectedWorkspaceId, new Date().toISOString());
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
              projectedSessionCount: projectedSessionMaterialization.projectedSessionCount,
              projectedSessionIds: projectedSessionMaterialization.projectedSessionIds,
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
    cloudWorkspace,
    cloudWorkspaceId,
    materializePendingWorkspaceSessions,
    pendingWorkspaceEntry,
    refreshCloudWorkspace,
    selectWorkspace,
    selectedWorkspaceId,
    setPendingWorkspaceEntry,
    setWorkspaceArrivalEvent,
    shouldHandleCachedCloudWorkspaceFailure,
    shouldHandleCachedCloudWorkspaceReady,
    shouldPollCloudWorkspace,
  ]);
}
