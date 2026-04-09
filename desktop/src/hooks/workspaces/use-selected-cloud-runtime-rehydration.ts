import { useEffect, useRef } from "react";
import { buildWorkspaceArrivalEvent } from "@/lib/domain/workspaces/arrival";
import { startLatencyTimer } from "@/lib/infra/debug-latency";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useWorkspaceBootstrapActions } from "./use-workspace-bootstrap-actions";
import { hasWorkspaceBootstrappedInSession } from "./workspace-bootstrap-memory";
import type { SelectedCloudRuntimeState } from "./use-selected-cloud-runtime-state";

export function useSelectedCloudRuntimeRehydration(
  selectedCloudRuntime: SelectedCloudRuntimeState,
): void {
  const runtimeUrl = useHarnessStore((state) => state.runtimeUrl);
  const setPendingWorkspaceEntry = useHarnessStore((state) => state.setPendingWorkspaceEntry);
  const setWorkspaceArrivalEvent = useHarnessStore((state) => state.setWorkspaceArrivalEvent);
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

    const pendingWorkspaceEntry = useHarnessStore.getState().pendingWorkspaceEntry;
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
      runtimeUrl,
      workspaceConnection: {
        runtimeUrl: connectionInfo.runtimeUrl,
        authToken: connectionInfo.accessToken,
        anyharnessWorkspaceId: connectionInfo.anyharnessWorkspaceId ?? "",
      },
      startedAt: startLatencyTimer(),
      isCurrent: () => useHarnessStore.getState().selectedWorkspaceId === workspaceId,
    });
  }, [
    bootstrapWorkspace,
    runtimeUrl,
    setPendingWorkspaceEntry,
    setWorkspaceArrivalEvent,
    selectedCloudRuntime.connectionInfo?.accessToken,
    selectedCloudRuntime.connectionInfo?.anyharnessWorkspaceId,
    selectedCloudRuntime.connectionInfo?.runtimeUrl,
    selectedCloudRuntime.state?.phase,
    selectedCloudRuntime.workspaceId,
  ]);
}
