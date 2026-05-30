import { useCallback } from "react";
import { usePushGitMutation } from "@anyharness/sdk-react";
import { useWorkspaceMobilityUiStore } from "@/stores/workspaces/workspace-mobility-ui-store";
import { useToastStore } from "@/stores/toast/toast-store";
import { useCloudToLocalHandoff } from "@/hooks/workspaces/mobility/use-cloud-to-local-handoff";
import { useLocalToCloudHandoff } from "@/hooks/workspaces/mobility/use-local-to-cloud-handoff";
import { elapsedMs, logLatency, startLatencyTimer } from "@/lib/infra/measurement/debug-latency";
import type { WorkspaceMobilityState } from "./use-workspace-mobility-state";

const PROMPT_PREPARE_TIMEOUT_MS = 12_000;
const PROMPT_PREPARE_TIMEOUT_MESSAGE = "Loading workspace move details took too long. Try again.";

function notifyIfSlow<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onSlow: () => void,
): Promise<T> {
  const timeoutId = window.setTimeout(onSlow, timeoutMs);
  return promise.finally(() => {
    window.clearTimeout(timeoutId);
  });
}

function isPromptRequestActive(
  logicalWorkspaceId: string | null,
  requestId: number | undefined,
): boolean {
  if (requestId === undefined || !logicalWorkspaceId) {
    return true;
  }

  return useWorkspaceMobilityUiStore.getState()
    .activePromptRequestIdByLogicalWorkspaceId[logicalWorkspaceId] === requestId;
}

export function useWorkspaceMobilityHandoffActions(state: WorkspaceMobilityState) {
  const clearConfirmSnapshot = useWorkspaceMobilityUiStore((store) => store.clearConfirmSnapshot);
  const setActivePromptRequestId = useWorkspaceMobilityUiStore((store) => store.setActivePromptRequestId);
  const clearActivePromptRequestId = useWorkspaceMobilityUiStore((store) => store.clearActivePromptRequestId);
  const showToast = useToastStore((store) => store.show);
  const {
    confirm: confirmLocalToCloud,
    isPending: isLocalToCloudPending,
    prepare: prepareLocalToCloud,
  } = useLocalToCloudHandoff({
    logicalWorkspace: state.selectedLogicalWorkspace,
    logicalWorkspaceId: state.selectedLogicalWorkspaceId,
    localWorkspaceId: state.localWorkspaceId,
    mobilityWorkspaceId: state.mobilityWorkspaceId,
  });
  const {
    confirm: confirmCloudToLocal,
    isPending: isCloudToLocalPending,
    prepare: prepareCloudToLocal,
  } = useCloudToLocalHandoff({
    logicalWorkspace: state.selectedLogicalWorkspace,
    logicalWorkspaceId: state.selectedLogicalWorkspaceId,
    cloudMaterializationId: state.cloudMaterializationId,
    mobilityWorkspaceId: state.mobilityWorkspaceId,
  });
  const sourceWorkspaceId = state.confirmSnapshot?.sourceWorkspaceId ?? null;
  const pushMutation = usePushGitMutation({ workspaceId: sourceWorkspaceId });

  const preparePrompt = useCallback(async (
    requestId?: number,
    options: { notifyOnSlow?: boolean } = {},
  ) => {
    const notifyOnSlow = options.notifyOnSlow ?? true;
    const startedAt = startLatencyTimer();
    const direction = state.canMoveToCloud
      ? "local_to_cloud"
      : state.canBringBackLocal
        ? "cloud_to_local"
        : "unavailable";
    logLatency("mobility.prepare.start", {
      requestId,
      logicalWorkspaceId: state.selectedLogicalWorkspaceId,
      direction,
      selectionLocked: state.selectionLocked,
    });
    try {
      if (state.canMoveToCloud) {
        const preparePromise = prepareLocalToCloud(requestId);
        await (notifyOnSlow
          ? notifyIfSlow(
            preparePromise,
            PROMPT_PREPARE_TIMEOUT_MS,
            () => {
              if (!isPromptRequestActive(state.selectedLogicalWorkspaceId, requestId)) {
                return;
              }
              showToast(PROMPT_PREPARE_TIMEOUT_MESSAGE, "info");
            },
          )
          : preparePromise);
        logLatency("mobility.prepare.complete", {
          requestId,
          logicalWorkspaceId: state.selectedLogicalWorkspaceId,
          direction: "local_to_cloud",
          elapsedMs: elapsedMs(startedAt),
        });
        return;
      }
      if (state.canBringBackLocal) {
        const preparePromise = prepareCloudToLocal(requestId);
        await (notifyOnSlow
          ? notifyIfSlow(
            preparePromise,
            PROMPT_PREPARE_TIMEOUT_MS,
            () => {
              if (!isPromptRequestActive(state.selectedLogicalWorkspaceId, requestId)) {
                return;
              }
              showToast(PROMPT_PREPARE_TIMEOUT_MESSAGE, "info");
            },
          )
          : preparePromise);
        logLatency("mobility.prepare.complete", {
          requestId,
          logicalWorkspaceId: state.selectedLogicalWorkspaceId,
          direction: "cloud_to_local",
          elapsedMs: elapsedMs(startedAt),
        });
        return;
      }
      logLatency("mobility.prepare.skipped", {
        requestId,
        logicalWorkspaceId: state.selectedLogicalWorkspaceId,
        elapsedMs: elapsedMs(startedAt),
      });
    } catch (error) {
      logLatency("mobility.prepare.failed", {
        requestId,
        logicalWorkspaceId: state.selectedLogicalWorkspaceId,
        direction,
        elapsedMs: elapsedMs(startedAt),
        error: error instanceof Error ? error.message : "unknown_error",
      });
      throw error;
    }
  }, [
    prepareCloudToLocal,
    prepareLocalToCloud,
    showToast,
    state.canBringBackLocal,
    state.canMoveToCloud,
    state.selectedLogicalWorkspaceId,
    state.selectionLocked,
  ]);

  const activatePromptRequest = useCallback((requestId: number) => {
    if (!state.selectedLogicalWorkspaceId) {
      return;
    }
    setActivePromptRequestId(state.selectedLogicalWorkspaceId, requestId);
  }, [setActivePromptRequestId, state.selectedLogicalWorkspaceId]);

  const clearPromptRequest = useCallback(() => {
    if (!state.selectedLogicalWorkspaceId) {
      return;
    }
    clearActivePromptRequestId(state.selectedLogicalWorkspaceId);
  }, [clearActivePromptRequestId, state.selectedLogicalWorkspaceId]);

  const confirmMove = useCallback(async (snapshot = state.confirmSnapshot) => {
    if (!snapshot) {
      return;
    }

    if (snapshot.direction === "local_to_cloud") {
      await confirmLocalToCloud(snapshot);
      return;
    }

    await confirmCloudToLocal(snapshot);
  }, [confirmCloudToLocal, confirmLocalToCloud, state.confirmSnapshot]);

  const clearPrompt = useCallback(() => {
    if (!state.selectedLogicalWorkspaceId) {
      return;
    }
    clearConfirmSnapshot(state.selectedLogicalWorkspaceId);
  }, [clearConfirmSnapshot, state.selectedLogicalWorkspaceId]);

  const syncBranchForSelectedMove = useCallback(async (): Promise<boolean> => {
    if (!sourceWorkspaceId) {
      showToast("This workspace can't push right now.");
      return false;
    }

    try {
      await pushMutation.mutateAsync({});
      return true;
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : "Failed to push this branch.",
      );
      return false;
    }
  }, [pushMutation, showToast, sourceWorkspaceId]);

  return {
    isHandoffPending: isLocalToCloudPending || isCloudToLocalPending,
    isSyncingBranch: pushMutation.isPending,
    preparePrompt,
    activatePromptRequest,
    clearPromptRequest,
    confirmMove,
    clearPrompt,
    syncBranchForSelectedMove,
  };
}
