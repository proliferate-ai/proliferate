import { useEffect, useRef } from "react";
import { buildWorkspaceArrivalEvent } from "@/lib/domain/workspaces/creation/arrival";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { logLatency, startLatencyTimer } from "@/lib/infra/measurement/debug-latency";
import { useWorkspaceBootstrapActions } from "@/hooks/workspaces/workflows/use-workspace-bootstrap-actions";
import {
  usePendingWorkspaceSessionMaterialization,
  useReadyWorkspaceProjectedSessionMaterialization,
} from "@/hooks/workspaces/workflows/use-pending-workspace-session-materialization";
import { hasWorkspaceBootstrappedInSession } from "./workspace-bootstrap-memory";
import type { SelectedCloudRuntimeState } from "@/hooks/workspaces/facade/use-selected-cloud-runtime-state";
import { withFreshCloudSandboxGatewayAccessToken } from "@/lib/access/cloud/cloud-sandbox-gateway";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";

export function useSelectedCloudRuntimeRehydration(
  selectedCloudRuntime: SelectedCloudRuntimeState,
): void {
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const selectedLogicalWorkspaceId = useSessionSelectionStore((state) => state.selectedLogicalWorkspaceId);
  const setPendingWorkspaceEntry = useSessionSelectionStore((state) => state.setPendingWorkspaceEntry);
  const setWorkspaceArrivalEvent = useSessionSelectionStore((state) => state.setWorkspaceArrivalEvent);
  const { bootstrapWorkspace } = useWorkspaceBootstrapActions();
  const materializePendingWorkspaceSessions = usePendingWorkspaceSessionMaterialization();
  const materializeReadyWorkspaceProjectedSessions =
    useReadyWorkspaceProjectedSessionMaterialization();
  const lastWorkspaceIdRef = useRef<string | null>(null);
  const shouldRehydrateOnReadyRef = useRef(false);
  const unmaterializedProjectedSessionKey = useSessionDirectoryStore((state) => {
    const workspaceId = selectedCloudRuntime.workspaceId;
    if (!workspaceId) {
      return "";
    }
    return (state.sessionIdsByWorkspaceId[workspaceId] ?? [])
      .filter((sessionId) => {
        const entry = state.entriesById[sessionId];
        return !!entry
          && !entry.materializedSessionId
          && entry.sessionRelationship.kind === "pending";
      })
      .join("|");
  });

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
    const hasUnmaterializedProjectedSessions = unmaterializedProjectedSessionKey.length > 0;

    if (
      state.phase !== "ready"
      || (
        !shouldRehydrateOnReadyRef.current
        && !hasAwaitingPendingWorkspaceEntry
        && !hasUnmaterializedProjectedSessions
      )
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
      const freshConnectionInfo = await withFreshCloudSandboxGatewayAccessToken(connectionInfo);
      if (!isBootstrapped) {
        await bootstrapWorkspace({
          workspaceId,
          logicalWorkspaceId: selectedLogicalWorkspaceId ?? workspaceId,
          workspaceConnection: {
            runtimeUrl: freshConnectionInfo.runtimeUrl,
            authToken: freshConnectionInfo.accessToken,
            anyharnessWorkspaceId: freshConnectionInfo.anyharnessWorkspaceId ?? "",
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
        if (hasUnmaterializedProjectedSessions) {
          materializeReadyWorkspaceProjectedSessions(
            workspaceId,
            { eventPrefix: "workspace.cloud_runtime_rehydration" },
          );
        }
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
    materializeReadyWorkspaceProjectedSessions,
    runtimeUrl,
    selectedLogicalWorkspaceId,
    setPendingWorkspaceEntry,
    setWorkspaceArrivalEvent,
    selectedCloudRuntime.connectionInfo?.accessToken,
    selectedCloudRuntime.connectionInfo?.anyharnessWorkspaceId,
    selectedCloudRuntime.connectionInfo?.runtimeUrl,
    selectedCloudRuntime.state?.phase,
    selectedCloudRuntime.workspaceId,
    unmaterializedProjectedSessionKey,
  ]);
}
