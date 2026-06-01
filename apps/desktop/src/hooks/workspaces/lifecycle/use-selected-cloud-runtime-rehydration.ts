import { useEffect, useRef } from "react";
import { buildWorkspaceArrivalEvent } from "@/lib/domain/workspaces/creation/arrival";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { logLatency, startLatencyTimer } from "@/lib/infra/measurement/debug-latency";
import { useWorkspaceBootstrapActions } from "@/hooks/workspaces/workflows/use-workspace-bootstrap-actions";
import { usePendingWorkspaceSessionMaterialization } from "@/hooks/workspaces/workflows/use-pending-workspace-session-materialization";
import { hasWorkspaceBootstrappedInSession } from "./workspace-bootstrap-memory";
import type { SelectedCloudRuntimeState } from "@/hooks/workspaces/facade/use-selected-cloud-runtime-state";

export function useSelectedCloudRuntimeRehydration(
  selectedCloudRuntime: SelectedCloudRuntimeState,
): void {
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const selectedLogicalWorkspaceId = useSessionSelectionStore((state) => state.selectedLogicalWorkspaceId);
  const setPendingWorkspaceEntry = useSessionSelectionStore((state) => state.setPendingWorkspaceEntry);
  const setWorkspaceArrivalEvent = useSessionSelectionStore((state) => state.setWorkspaceArrivalEvent);
  const { bootstrapWorkspace } = useWorkspaceBootstrapActions();
  const materializePendingWorkspaceSessions = usePendingWorkspaceSessionMaterialization();
  const lastWorkspaceIdRef = useRef<string | null>(null);
  const shouldRehydrateOnReadyRef = useRef(false);

  useEffect(() => {
    const workspaceId = selectedCloudRuntime.workspaceId;
    if (workspaceId !== lastWorkspaceIdRef.current) {
      lastWorkspaceIdRef.current = workspaceId;
      shouldRehydrateOnReadyRef.current = workspaceId
        ? !hasWorkspaceBootstrappedInSession(workspaceId)
        : false;
    }

    const state = selectedCloudRuntime.state;
    const connectionInfo = selectedCloudRuntime.connectionInfo;
    if (!workspaceId || !state) {
      return;
    }
    const isBootstrapped = hasWorkspaceBootstrappedInSession(workspaceId);

    if (state.phase !== "ready") {
      shouldRehydrateOnReadyRef.current = true;
    }

    const pendingWorkspaceEntry = useSessionSelectionStore.getState().pendingWorkspaceEntry;
    const hasAwaitingPendingWorkspaceEntry = Boolean(
      pendingWorkspaceEntry
        && pendingWorkspaceEntry.workspaceId === workspaceId
        && pendingWorkspaceEntry.stage === "awaiting-cloud-ready",
    );

    if (
      state.phase !== "ready"
      || (!shouldRehydrateOnReadyRef.current && !hasAwaitingPendingWorkspaceEntry)
      || !connectionInfo
    ) {
      return;
    }

    if (!shouldRehydrateOnReadyRef.current && isBootstrapped && !hasAwaitingPendingWorkspaceEntry) {
      return;
    }

    shouldRehydrateOnReadyRef.current = false;

    let cancelled = false;
    void (async () => {
      if (!isBootstrapped) {
        await bootstrapWorkspace({
          workspaceId,
          logicalWorkspaceId: selectedLogicalWorkspaceId ?? workspaceId,
          runtimeUrl,
          workspaceConnection: {
            runtimeUrl: connectionInfo.runtimeUrl,
            authToken: connectionInfo.accessToken,
            anyharnessWorkspaceId: connectionInfo.anyharnessWorkspaceId ?? "",
          },
          startedAt: startLatencyTimer(),
          isCurrent: () => useSessionSelectionStore.getState().selectedWorkspaceId === workspaceId,
        });
      }

      if (cancelled) {
        return;
      }

      const pendingWorkspaceEntry = useSessionSelectionStore.getState().pendingWorkspaceEntry;
      if (
        !pendingWorkspaceEntry
        || pendingWorkspaceEntry.workspaceId !== workspaceId
        || pendingWorkspaceEntry.stage !== "awaiting-cloud-ready"
      ) {
        return;
      }

      materializePendingWorkspaceSessions(
        pendingWorkspaceEntry,
        workspaceId,
        { eventPrefix: "workspace.cloud_runtime_rehydration" },
      );
      setPendingWorkspaceEntry(null);
      setWorkspaceArrivalEvent(buildWorkspaceArrivalEvent({
        workspaceId,
        source: pendingWorkspaceEntry.source,
        setupScript: pendingWorkspaceEntry.setupScript,
        baseBranchName: pendingWorkspaceEntry.baseBranchName,
      }));
    })().catch((error) => {
      if (!cancelled) {
        shouldRehydrateOnReadyRef.current = true;
      }
      const message = error instanceof Error
        ? error.message
        : "Failed to rehydrate cloud workspace runtime.";
      logLatency("workspace.cloud_runtime_rehydration.failed", {
        workspaceId,
        errorMessage: message,
      });
    });

    return () => {
      cancelled = true;
    };
  }, [
    bootstrapWorkspace,
    materializePendingWorkspaceSessions,
    runtimeUrl,
    selectedLogicalWorkspaceId,
    setPendingWorkspaceEntry,
    setWorkspaceArrivalEvent,
    selectedCloudRuntime.connectionInfo?.accessToken,
    selectedCloudRuntime.connectionInfo?.anyharnessWorkspaceId,
    selectedCloudRuntime.connectionInfo?.runtimeUrl,
    selectedCloudRuntime.state?.phase,
    selectedCloudRuntime.workspaceId,
  ]);
}
