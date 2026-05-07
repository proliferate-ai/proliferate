import { useEffect, useRef } from "react";
import { buildWorkspaceArrivalEvent } from "@/lib/domain/workspaces/creation/arrival";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { startLatencyTimer } from "@/lib/infra/measurement/debug-latency";
import { useWorkspaceBootstrapActions } from "./use-workspace-bootstrap-actions";
import { hasWorkspaceBootstrappedInSession } from "./workspace-bootstrap-memory";
import type { SelectedCloudRuntimeState } from "./use-selected-cloud-runtime-state";

export function useSelectedCloudRuntimeRehydration(
  selectedCloudRuntime: SelectedCloudRuntimeState,
): void {
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const selectedLogicalWorkspaceId = useSessionSelectionStore((state) => state.selectedLogicalWorkspaceId);
  const setPendingWorkspaceEntry = useSessionSelectionStore((state) => state.setPendingWorkspaceEntry);
  const setWorkspaceArrivalEvent = useSessionSelectionStore((state) => state.setWorkspaceArrivalEvent);
  const { bootstrapWorkspace } = useWorkspaceBootstrapActions();
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

    if (
      state.phase !== "ready"
      || !shouldRehydrateOnReadyRef.current
      || !connectionInfo
    ) {
      return;
    }

    const pendingWorkspaceEntry = useSessionSelectionStore.getState().pendingWorkspaceEntry;
    if (
      pendingWorkspaceEntry
      && pendingWorkspaceEntry.workspaceId === workspaceId
      && pendingWorkspaceEntry.stage === "awaiting-cloud-ready"
    ) {
      setPendingWorkspaceEntry(null);
      setWorkspaceArrivalEvent(buildWorkspaceArrivalEvent({
        workspaceId,
        source: pendingWorkspaceEntry.source,
        setupScript: pendingWorkspaceEntry.setupScript,
        baseBranchName: pendingWorkspaceEntry.baseBranchName,
      }));
    }

    if (!shouldRehydrateOnReadyRef.current && isBootstrapped) {
      return;
    }

    shouldRehydrateOnReadyRef.current = false;
    void bootstrapWorkspace({
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
  }, [
    bootstrapWorkspace,
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
