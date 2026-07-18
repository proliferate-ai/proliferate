import { useCallback, useMemo } from "react";
import type { GoalArmState } from "@anyharness/sdk";
import {
  useCancelSessionMutation,
  useClearSessionGoalMutation,
  useSetSessionGoalMutation,
} from "@anyharness/sdk-react";
import type { GoalWire } from "@proliferate/product-domain/activity/goal";
import { logLatency } from "#product/lib/infra/measurement/measurement-port";
import { useActiveSessionId } from "#product/hooks/chat/derived/use-active-session-identity";
import {
  buildQueuedGoalObjectiveRequest,
  enqueueSessionGoalLifecycleMutation,
  recordSessionGoalCleared,
  recordSessionGoalMutation,
  requireGoalArmState,
  requireSafeGoalClear,
  sessionCancelGoalFence,
  stopGoalThenCancelCurrentWork,
} from "#product/hooks/sessions/workflows/session-goal-lifecycle";
import { goalResultDismissKey, useGoalBarStore } from "#product/stores/activity/goal-bar-store";
import { getSessionRecord, patchSessionRecord } from "#product/stores/sessions/session-records";
import { useToastStore } from "#product/stores/toast/toast-store";

export interface SessionGoalActions {
  editGoal: (objective: string) => void;
  pauseGoal: () => void;
  resumeGoal: () => void;
  clearGoal: () => void;
  dismissResult: () => void;
  beginComposing: () => void;
  cancelComposing: () => void;
  /** A goal mutation is in flight awaiting the native round-trip. */
  pendingWrite: boolean;
}

interface GoalMutationTarget {
  clientSessionId: string;
  sessionId: string;
  workspaceId: string;
}

/**
 * Goal mutations for the active session. Goals are strict mirrors of native
 * harness state: every write goes through the runtime goal surface
 * (PUT/DELETE /v1/sessions/{id}/goal → `_anyharness/goal/set|clear`). The slot
 * mirror transitions solely from streamed goal events; mutation responses
 * provide only short-lived lifecycle intent while that authoritative stream
 * catches up. Claude may return a provisional deferred-set response before its
 * native notification reaches the mirror.
 *
 * Dismissal and compose-mode are client-only UI state.
 */
export function useSessionGoalActions(goal: GoalWire | null): SessionGoalActions {
  const activeSessionId = useActiveSessionId();
  const setGoalMutation = useSetSessionGoalMutation();
  const clearGoalMutation = useClearSessionGoalMutation();
  const cancelSessionMutation = useCancelSessionMutation();
  const showToast = useToastStore((state) => state.show);
  const beginComposingInStore = useGoalBarStore((state) => state.beginComposing);
  const endComposingInStore = useGoalBarStore((state) => state.endComposing);
  const dismissResultInStore = useGoalBarStore((state) => state.dismissResult);
  const setPendingGoalInStore = useGoalBarStore((state) => state.setPendingGoal);
  const clearPendingGoalInStore = useGoalBarStore((state) => state.clearPendingGoal);

  const beginComposing = useCallback(() => {
    if (activeSessionId) {
      beginComposingInStore(activeSessionId);
    }
  }, [activeSessionId, beginComposingInStore]);

  const endComposing = useCallback(() => {
    if (activeSessionId) {
      endComposingInStore(activeSessionId);
    }
  }, [activeSessionId, endComposingInStore]);

  const resolveGoalTarget = useCallback((): GoalMutationTarget | null => {
    if (!activeSessionId) {
      return null;
    }
    const record = getSessionRecord(activeSessionId);
    if (!record?.materializedSessionId || !record.workspaceId) {
      return null;
    }
    return {
      clientSessionId: activeSessionId,
      sessionId: record.materializedSessionId,
      workspaceId: record.workspaceId,
    };
  }, [activeSessionId]);

  const editGoal = useCallback((objective: string) => {
    const target = resolveGoalTarget();
    const trimmed = objective.trim();
    if (!target || !trimmed) {
      endComposing();
      return;
    }
    // Close the editor and install the provisional pending goal immediately —
    // the bar transitions from editor → provisional live row with no gap.
    endComposingInStore(target.clientSessionId);
    setPendingGoalInStore(target.clientSessionId, trimmed);
    void enqueueSessionGoalLifecycleMutation(target.clientSessionId, async () => {
      const result = await setGoalMutation.mutateAsync({
        sessionId: target.sessionId,
        workspaceId: target.workspaceId,
        request: buildQueuedGoalObjectiveRequest(
          target.sessionId,
          trimmed,
          getSessionRecord(target.clientSessionId)?.activeGoal ?? null,
        ),
      });
      recordSessionGoalMutation(target.sessionId, result.goal);
      return result;
    })
      .catch((error) => {
        clearPendingGoalInStore(target.clientSessionId);
        const message = error instanceof Error ? error.message : String(error);
        logLatency("session.goal.set.failed", { sessionId: target.sessionId, message });
        showToast(`Failed to set goal: ${message}`);
      });
  }, [clearPendingGoalInStore, endComposing, endComposingInStore, resolveGoalTarget, setPendingGoalInStore, setGoalMutation, showToast]);

  const cancelCurrentWork = useCallback(async (target: GoalMutationTarget) => {
    const result = await cancelSessionMutation.mutateAsync({
      sessionId: target.sessionId,
      workspaceId: target.workspaceId,
    });
    patchSessionRecord(target.clientSessionId, { status: "idle" });
    return result;
  }, [cancelSessionMutation]);

  const setArmState = useCallback((status: GoalArmState) => {
    const target = resolveGoalTarget();
    if (!target) {
      return;
    }
    void enqueueSessionGoalLifecycleMutation(target.clientSessionId, async () => {
      const result = await setGoalMutation.mutateAsync({
        sessionId: target.sessionId,
        workspaceId: target.workspaceId,
        request: { status },
      });
      requireGoalArmState(result.goal, status);
      recordSessionGoalMutation(target.sessionId, result.goal);
      return result;
    })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        logLatency("session.goal.arm.failed", { sessionId: target.sessionId, status, message });
        showToast(`Failed to ${status === "paused" ? "pause" : "resume"} goal: ${message}`);
      });
  }, [resolveGoalTarget, setGoalMutation, showToast]);

  const pauseGoal = useCallback(() => {
    const target = resolveGoalTarget();
    if (!target) {
      return;
    }
    void enqueueSessionGoalLifecycleMutation(target.clientSessionId, () => (
      stopGoalThenCancelCurrentWork({
        stopGoal: async () => {
          const result = await setGoalMutation.mutateAsync({
            sessionId: target.sessionId,
            workspaceId: target.workspaceId,
            request: { status: "paused" },
          });
          requireGoalArmState(result.goal, "paused");
          recordSessionGoalMutation(target.sessionId, result.goal);
        },
        cancelCurrentWork: () => cancelCurrentWork(target),
      })
    )).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      logLatency("session.goal.arm.failed", {
        sessionId: target.sessionId,
        status: "paused",
        message,
      });
      showToast(`Failed to pause goal or stop current work: ${message}`);
    });
  }, [cancelCurrentWork, resolveGoalTarget, setGoalMutation, showToast]);

  const resumeGoal = useCallback(() => {
    setArmState("active");
  }, [setArmState]);

  const clearGoal = useCallback(() => {
    const target = resolveGoalTarget();
    if (!target) {
      return;
    }
    void enqueueSessionGoalLifecycleMutation(target.clientSessionId, () => (
      stopGoalThenCancelCurrentWork({
        stopGoal: async () => {
          const mirrorGoal = getSessionRecord(target.clientSessionId)?.activeGoal ?? null;
          const fence = sessionCancelGoalFence({
            materializedSessionId: target.sessionId,
            mirrorGoal,
            pauseSupported: false,
          });
          const response = await clearGoalMutation.mutateAsync({
            sessionId: target.sessionId,
            workspaceId: target.workspaceId,
          });
          requireSafeGoalClear(response, fence);
          recordSessionGoalCleared(target.sessionId, mirrorGoal);
        },
        cancelCurrentWork: () => cancelCurrentWork(target),
      })
    ))
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        logLatency("session.goal.clear.failed", { sessionId: target.sessionId, message });
        showToast(`Failed to clear goal or stop current work: ${message}`);
      });
  }, [cancelCurrentWork, clearGoalMutation, resolveGoalTarget, showToast]);

  const dismissResult = useCallback(() => {
    if (!goal || !activeSessionId) {
      return;
    }
    dismissResultInStore(activeSessionId, goalResultDismissKey(goal.status, goal.updatedAtMs));
  }, [activeSessionId, dismissResultInStore, goal]);

  const pendingWrite =
    setGoalMutation.isPending
    || clearGoalMutation.isPending
    || cancelSessionMutation.isPending;

  return useMemo(() => ({
    editGoal,
    pauseGoal,
    resumeGoal,
    clearGoal,
    dismissResult,
    beginComposing,
    cancelComposing: endComposing,
    pendingWrite,
  }), [
    beginComposing,
    clearGoal,
    dismissResult,
    editGoal,
    endComposing,
    pauseGoal,
    pendingWrite,
    resumeGoal,
  ]);
}
