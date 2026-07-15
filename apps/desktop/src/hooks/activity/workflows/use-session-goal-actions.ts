import { useCallback, useMemo } from "react";
import type { GoalArmState } from "@anyharness/sdk";
import { useClearSessionGoalMutation, useSetSessionGoalMutation } from "@anyharness/sdk-react";
import type { GoalWire } from "@proliferate/product-domain/activity/goal";
import { logLatency } from "@/lib/infra/measurement/debug-latency";
import { useActiveSessionId } from "@/hooks/chat/derived/use-active-session-identity";
import { goalResultDismissKey, useGoalBarStore } from "@/stores/activity/goal-bar-store";
import { getSessionRecord } from "@/stores/sessions/session-records";
import { useToastStore } from "@/stores/toast/toast-store";

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

/**
 * Goal mutations for the active session. Goals are strict mirrors of native
 * harness state: every write goes through the runtime goal surface
 * (PUT/DELETE /v1/sessions/{id}/goal → `_anyharness/goal/set|clear`), which
 * responds only after the native notification round-trips. The slot mirror
 * transitions solely from the stream's goal_* events (the single authoritative
 * writer) — never optimistically and never from the mutation response, so two
 * unordered writers can't clobber each other. The resolved promise is used
 * only for compose/pending/error handling.
 *
 * Dismissal and compose-mode are client-only UI state.
 */
export function useSessionGoalActions(goal: GoalWire | null): SessionGoalActions {
  const activeSessionId = useActiveSessionId();
  const setGoalMutation = useSetSessionGoalMutation();
  const clearGoalMutation = useClearSessionGoalMutation();
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

  const resolveGoalTarget = useCallback(() => {
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
    void setGoalMutation
      .mutateAsync({
        sessionId: target.sessionId,
        workspaceId: target.workspaceId,
        request: { objective: trimmed },
      })
      .catch((error) => {
        clearPendingGoalInStore(target.clientSessionId);
        const message = error instanceof Error ? error.message : String(error);
        logLatency("session.goal.set.failed", { sessionId: target.sessionId, message });
        showToast(`Failed to set goal: ${message}`);
      });
  }, [clearPendingGoalInStore, endComposing, endComposingInStore, resolveGoalTarget, setPendingGoalInStore, setGoalMutation, showToast]);

  const setArmState = useCallback((status: GoalArmState) => {
    const target = resolveGoalTarget();
    if (!target) {
      return;
    }
    void setGoalMutation
      .mutateAsync({
        sessionId: target.sessionId,
        workspaceId: target.workspaceId,
        request: { status },
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        logLatency("session.goal.arm.failed", { sessionId: target.sessionId, status, message });
        showToast(`Failed to ${status === "paused" ? "pause" : "resume"} goal: ${message}`);
      });
  }, [resolveGoalTarget, setGoalMutation, showToast]);

  const pauseGoal = useCallback(() => {
    setArmState("paused");
  }, [setArmState]);

  const resumeGoal = useCallback(() => {
    setArmState("active");
  }, [setArmState]);

  const clearGoal = useCallback(() => {
    const target = resolveGoalTarget();
    if (!target) {
      return;
    }
    void clearGoalMutation
      .mutateAsync({
        sessionId: target.sessionId,
        workspaceId: target.workspaceId,
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        logLatency("session.goal.clear.failed", { sessionId: target.sessionId, message });
        showToast(`Failed to clear goal: ${message}`);
      });
  }, [clearGoalMutation, resolveGoalTarget, showToast]);

  const dismissResult = useCallback(() => {
    if (!goal || !activeSessionId) {
      return;
    }
    dismissResultInStore(activeSessionId, goalResultDismissKey(goal.status, goal.updatedAtMs));
  }, [activeSessionId, dismissResultInStore, goal]);

  const pendingWrite = setGoalMutation.isPending || clearGoalMutation.isPending;

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
