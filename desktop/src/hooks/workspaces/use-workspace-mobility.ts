import { useCallback } from "react";
import { usePushGitMutation } from "@anyharness/sdk-react";
import { useWorkspaceMobilityUiStore } from "@/stores/workspaces/workspace-mobility-ui-store";
import { useToastStore } from "@/stores/toast/toast-store";
import { useCompleteCloudWorkspaceHandoffCleanup } from "@/hooks/cloud/use-complete-cloud-workspace-handoff-cleanup";
import { useCloudWorkspaceHandoffHeartbeatLoop } from "@/hooks/workspaces/mobility/use-cloud-workspace-handoff-heartbeat-loop";
import { useCloudToLocalHandoff } from "@/hooks/workspaces/mobility/use-cloud-to-local-handoff";
import { useLocalToCloudHandoff } from "@/hooks/workspaces/mobility/use-local-to-cloud-handoff";
import { useWorkspaceMobilityState } from "@/hooks/workspaces/mobility/use-workspace-mobility-state";
import { elapsedMs, logLatency, startLatencyTimer } from "@/lib/infra/debug-latency";

const PROMPT_PREPARE_TIMEOUT_MS = 12_000;
const PROMPT_PREPARE_TIMEOUT_MESSAGE = "Loading workspace move details took too long. Try again.";

function isPromptPrepareTimeoutError(error: unknown): error is Error {
  return error instanceof Error && error.message === PROMPT_PREPARE_TIMEOUT_MESSAGE;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  let timeoutId: number | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = window.setTimeout(() => {
          reject(new Error(timeoutMessage));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
    }
  }
}

export function useWorkspaceMobility() {
  const state = useWorkspaceMobilityState();
  const clearConfirmSnapshot = useWorkspaceMobilityUiStore((store) => store.clearConfirmSnapshot);
  const setActivePromptRequestId = useWorkspaceMobilityUiStore((store) => store.setActivePromptRequestId);
  const clearActivePromptRequestId = useWorkspaceMobilityUiStore((store) => store.clearActivePromptRequestId);
  const dismissMcpNotice = useWorkspaceMobilityUiStore((store) => store.dismissMcpNotice);
  const showToast = useToastStore((store) => store.show);
  const localToCloud = useLocalToCloudHandoff({
    logicalWorkspace: state.selectedLogicalWorkspace,
    logicalWorkspaceId: state.selectedLogicalWorkspaceId,
    localWorkspaceId: state.localWorkspaceId,
    mobilityWorkspaceId: state.mobilityWorkspaceId,
  });
  const cloudToLocal = useCloudToLocalHandoff({
    logicalWorkspace: state.selectedLogicalWorkspace,
    logicalWorkspaceId: state.selectedLogicalWorkspaceId,
    cloudMaterializationId: state.cloudMaterializationId,
    mobilityWorkspaceId: state.mobilityWorkspaceId,
  });
  const retryCleanupMutation = useCompleteCloudWorkspaceHandoffCleanup();
  const pushMutation = usePushGitMutation({ workspaceId: state.localWorkspaceId });

  useCloudWorkspaceHandoffHeartbeatLoop({
    mobilityWorkspaceId: state.mobilityWorkspaceId,
    handoffOpId: state.mobilityWorkspaceDetail?.activeHandoff?.id
      ?? state.selectedLogicalWorkspace?.mobilityWorkspace?.activeHandoff?.id
      ?? null,
    enabled: state.status.phase !== "idle"
      && state.status.phase !== "failed"
      && state.status.phase !== "cleanup_failed"
      && state.status.phase !== "success",
  });

  const preparePrompt = useCallback(async (requestId?: number) => {
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
        await withTimeout(
          localToCloud.prepare(requestId),
          PROMPT_PREPARE_TIMEOUT_MS,
          PROMPT_PREPARE_TIMEOUT_MESSAGE,
        );
        logLatency("mobility.prepare.complete", {
          requestId,
          logicalWorkspaceId: state.selectedLogicalWorkspaceId,
          direction: "local_to_cloud",
          elapsedMs: elapsedMs(startedAt),
        });
        return;
      }
      if (state.canBringBackLocal) {
        await withTimeout(
          cloudToLocal.prepare(requestId),
          PROMPT_PREPARE_TIMEOUT_MS,
          PROMPT_PREPARE_TIMEOUT_MESSAGE,
        );
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
      if (
        requestId !== undefined
        && state.selectedLogicalWorkspaceId
        && isPromptPrepareTimeoutError(error)
      ) {
        clearActivePromptRequestId(state.selectedLogicalWorkspaceId);
      }
      logLatency("mobility.prepare.failed", {
        requestId,
        logicalWorkspaceId: state.selectedLogicalWorkspaceId,
        direction,
        elapsedMs: elapsedMs(startedAt),
        error: error instanceof Error ? error.message : "unknown_error",
      });
      showToast(
        error instanceof Error
          ? error.message
          : "Failed to load workspace mobility details.",
      );
      throw error;
    }
  }, [
    clearActivePromptRequestId,
    cloudToLocal,
    localToCloud,
    showToast,
    state.canBringBackLocal,
    state.canMoveToCloud,
    state.selectedLogicalWorkspaceId,
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

  const confirmMove = useCallback(async () => {
    if (!state.confirmSnapshot) {
      return;
    }

    if (state.confirmSnapshot.direction === "local_to_cloud") {
      await localToCloud.confirm(state.confirmSnapshot);
      return;
    }

    await cloudToLocal.confirm(state.confirmSnapshot);
  }, [cloudToLocal, localToCloud, state.confirmSnapshot]);

  const clearPrompt = useCallback(() => {
    if (!state.selectedLogicalWorkspaceId) {
      return;
    }
    clearConfirmSnapshot(state.selectedLogicalWorkspaceId);
  }, [clearConfirmSnapshot, state.selectedLogicalWorkspaceId]);

  const dismissNotice = useCallback(() => {
    if (!state.selectedLogicalWorkspaceId) {
      return;
    }
    dismissMcpNotice(state.selectedLogicalWorkspaceId);
  }, [dismissMcpNotice, state.selectedLogicalWorkspaceId]);

  const retryCleanup = useCallback(async () => {
    const handoffOpId = state.status.activeHandoff?.id;
    if (!state.mobilityWorkspaceId || !handoffOpId) {
      showToast("Cleanup can't be retried right now.");
      return;
    }

    try {
      await retryCleanupMutation.mutateAsync({
        mobilityWorkspaceId: state.mobilityWorkspaceId,
        handoffOpId,
      });
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : "Cleanup retry failed.",
      );
    }
  }, [
    retryCleanupMutation,
    showToast,
    state.mobilityWorkspaceId,
    state.status.activeHandoff?.id,
  ]);

  const syncBranchForCloudMove = useCallback(async (): Promise<boolean> => {
    if (!state.localWorkspaceId) {
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
  }, [pushMutation, showToast, state.localWorkspaceId]);

  return {
    ...state,
    isPending:
      localToCloud.isPending
      || cloudToLocal.isPending
      || retryCleanupMutation.isPending,
    isSyncingBranch: pushMutation.isPending,
    preparePrompt,
    activatePromptRequest,
    clearPromptRequest,
    confirmMove,
    clearPrompt,
    dismissNotice,
    retryCleanup,
    syncBranchForCloudMove,
  };
}
