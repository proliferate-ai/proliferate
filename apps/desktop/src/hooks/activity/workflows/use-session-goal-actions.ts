import { useCallback, useMemo } from "react";
import type { GoalArmState } from "@anyharness/sdk";
import { useClearSessionGoalMutation, useSetSessionGoalMutation } from "@anyharness/sdk-react";
import type { GoalWire } from "@proliferate/product-domain/activity/goal";
import { logLatency } from "@/lib/infra/measurement/debug-latency";
import { useActiveSessionId } from "@/hooks/chat/derived/use-active-session-identity";
import { goalResultDismissKey, useGoalBarStore } from "@/stores/activity/goal-bar-store";
import { getSessionRecord, patchSessionRecord } from "@/stores/sessions/session-records";

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
 * transitions from the stream's goal_* events (and the confirmed response is
 * applied as the same round-tripped state) — never optimistically.
 *
 * Dismissal and compose-mode are client-only UI state.
 */
export function useSessionGoalActions(goal: GoalWire | null): SessionGoalActions {
  const activeSessionId = useActiveSessionId();
  const setGoalMutation = useSetSessionGoalMutation();
  const clearGoalMutation = useClearSessionGoalMutation();
  const beginComposing = useGoalBarStore((state) => state.beginComposing);
  const endComposing = useGoalBarStore((state) => state.endComposing);
  const dismissResultInStore = useGoalBarStore((state) => state.dismissResult);

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
    void setGoalMutation
      .mutateAsync({
        sessionId: target.sessionId,
        workspaceId: target.workspaceId,
        request: { objective: trimmed },
      })
      .then((response) => {
        patchSessionRecord(target.clientSessionId, { activeGoal: response.goal });
        endComposing();
      })
      .catch((error) => {
        logLatency("session.goal.set.failed", {
          sessionId: target.sessionId,
          message: error instanceof Error ? error.message : String(error),
        });
      });
  }, [endComposing, resolveGoalTarget, setGoalMutation]);

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
      .then((response) => {
        patchSessionRecord(target.clientSessionId, { activeGoal: response.goal });
      })
      .catch((error) => {
        logLatency("session.goal.arm.failed", {
          sessionId: target.sessionId,
          status,
          message: error instanceof Error ? error.message : String(error),
        });
      });
  }, [resolveGoalTarget, setGoalMutation]);

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
      .then(() => {
        patchSessionRecord(target.clientSessionId, { activeGoal: null });
      })
      .catch((error) => {
        logLatency("session.goal.clear.failed", {
          sessionId: target.sessionId,
          message: error instanceof Error ? error.message : String(error),
        });
      });
  }, [clearGoalMutation, resolveGoalTarget]);

  const dismissResult = useCallback(() => {
    if (!goal) {
      return;
    }
    dismissResultInStore(goalResultDismissKey(goal.status, goal.updatedAtMs));
  }, [dismissResultInStore, goal]);

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
