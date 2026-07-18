import {
  useCancelSessionMutation,
  useClearSessionGoalMutation,
  useSetSessionGoalMutation,
} from "@anyharness/sdk-react";
import { useCallback } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { useWorkspaceRuntimeBlock } from "#product/hooks/workspaces/derived/use-workspace-runtime-block";
import { goalCapabilitiesForSession } from "#product/lib/domain/sessions/goal-mirror";
import {
  enqueueSessionGoalLifecycleMutation,
  recordSessionGoalCleared,
  recordSessionGoalMutation,
  requireGoalArmState,
  requireSafeGoalClear,
  sessionCancelGoalFence,
  SessionGoalStopError,
  stopGoalThenCancelCurrentWork,
} from "#product/hooks/sessions/workflows/session-goal-lifecycle";
import {
  getSessionClientAndWorkspace,
} from "#product/lib/access/anyharness/session-runtime";
import {
  getSessionRecord,
  patchSessionRecord,
} from "#product/stores/sessions/session-records";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useToastStore } from "#product/stores/toast/toast-store";

export function useSessionCancelActions() {
  const host = useProductHost();
  const ssh = host.desktop?.ssh ?? null;
  const cloudClient = host.cloud.client;
  const { getWorkspaceRuntimeBlockReason } = useWorkspaceRuntimeBlock();
  const showToast = useToastStore((state) => state.show);
  const cancelSessionMutation = useCancelSessionMutation();
  const clearGoalMutation = useClearSessionGoalMutation();
  const setGoalMutation = useSetSessionGoalMutation();

  const cancelActiveSession = useCallback(async () => {
    const state = useSessionSelectionStore.getState();
    const sessionId = state.activeSessionId;
    if (!sessionId) {
      return;
    }

    const initialRecord = getSessionRecord(sessionId);
    const selectedWorkspaceId = initialRecord?.workspaceId ?? state.selectedWorkspaceId;
    const blockedReason = getWorkspaceRuntimeBlockReason(selectedWorkspaceId);
    if (blockedReason) {
      showToast(blockedReason);
      return;
    }

    try {
      // Enqueue before the first async lookup so a later goal write or Resume
      // click cannot overtake the user's earlier Cancel intent.
      await enqueueSessionGoalLifecycleMutation(sessionId, async () => {
        const { materializedSessionId, workspaceId } = await getSessionClientAndWorkspace(
          sessionId,
          ssh,
          cloudClient,
        );
        // Re-read after earlier queued goal writes have settled. The streamed
        // mirror can lag a successful response, so the lifecycle helper also
        // considers the latest confirmed product-side intent.
        const record = getSessionRecord(sessionId);
        const pauseSupported = record
          ? goalCapabilitiesForSession(record.actionCapabilities, record.agentKind).pause
          : false;
        const fence = sessionCancelGoalFence({
          materializedSessionId,
          mirrorGoal: record?.activeGoal ?? null,
          pauseSupported,
        });
        const cancelCurrentWork = () => cancelSessionMutation.mutateAsync({
          workspaceId,
          sessionId: materializedSessionId,
        });

        if (fence.action === "none") {
          await cancelCurrentWork();
        } else {
          await stopGoalThenCancelCurrentWork({
            stopGoal: async () => {
              if (fence.action === "pause") {
                const response = await setGoalMutation.mutateAsync({
                  workspaceId,
                  sessionId: materializedSessionId,
                  request: { status: "paused" },
                });
                requireGoalArmState(response.goal, "paused");
                recordSessionGoalMutation(materializedSessionId, response.goal);
              } else {
                const response = await clearGoalMutation.mutateAsync({
                  workspaceId,
                  sessionId: materializedSessionId,
                });
                requireSafeGoalClear(response, fence);
                recordSessionGoalCleared(materializedSessionId, record?.activeGoal ?? null);
              }
            },
            cancelCurrentWork,
          });
        }
        patchSessionRecord(sessionId, { status: "idle" });
      });
    } catch (error) {
      if (error instanceof SessionGoalStopError) {
        showToast("Could not confirm the goal stopped, so current work was not cancelled.");
      }
      // Preserve the confirmed stop intent when only cancellation failed; a
      // retry re-reads it and does not re-arm or repeat the stop mutation.
    }
  }, [
    cancelSessionMutation,
    clearGoalMutation,
    cloudClient,
    getWorkspaceRuntimeBlockReason,
    setGoalMutation,
    showToast,
    ssh,
  ]);

  return { cancelActiveSession };
}
