import { useCallback, useMemo } from "react";
import { useClearSessionLoopMutation, useSetSessionLoopMutation } from "@anyharness/sdk-react";
import type { LoopArmInput } from "@proliferate/product-ui/activity/LoopsPanel";
import { logLatency } from "@/lib/infra/measurement/debug-latency";
import { useActiveSessionId } from "@/hooks/chat/derived/use-active-session-identity";
import { getSessionRecord } from "@/stores/sessions/session-records";
import { useToastStore } from "@/stores/toast/toast-store";

export interface SessionLoopActions {
  armLoop: (input: LoopArmInput) => void;
  deleteLoop: (loopId: string) => void;
  /** A loop mutation is in flight awaiting the native round-trip. */
  pendingWrite: boolean;
}

/**
 * Loop mutations for the active session. Loops are strict mirrors where native
 * (Claude session crons) and runtime-emulated where not (Codex, `native:
 * false`): every write goes through the runtime loop surface
 * (PUT/DELETE /v1/sessions/{id}/loops(+/{loop_id})). The slot mirror
 * transitions solely from the stream's loop_upserted/loop_removed events (the
 * single authoritative writer) — never optimistically and never from the
 * mutation response, so the panel only reflects a change once it round-trips.
 * The resolved promise is used only for pending/error handling.
 */
export function useSessionLoopActions(): SessionLoopActions {
  const activeSessionId = useActiveSessionId();
  const setLoopMutation = useSetSessionLoopMutation();
  const clearLoopMutation = useClearSessionLoopMutation();
  const showToast = useToastStore((state) => state.show);

  const resolveLoopTarget = useCallback(() => {
    if (!activeSessionId) {
      return null;
    }
    const record = getSessionRecord(activeSessionId);
    if (!record?.materializedSessionId || !record.workspaceId) {
      return null;
    }
    return {
      sessionId: record.materializedSessionId,
      workspaceId: record.workspaceId,
    };
  }, [activeSessionId]);

  const armLoop = useCallback((input: LoopArmInput) => {
    const target = resolveLoopTarget();
    const prompt = input.prompt.trim();
    const expr = input.schedule.expr.trim();
    if (!target || !prompt || !expr) {
      return;
    }
    void setLoopMutation
      .mutateAsync({
        sessionId: target.sessionId,
        workspaceId: target.workspaceId,
        request: {
          prompt,
          schedule: { kind: input.schedule.kind, expr },
          recurring: input.recurring,
        },
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        logLatency("session.loop.set.failed", { sessionId: target.sessionId, message });
        showToast(`Failed to arm loop: ${message}`);
      });
  }, [resolveLoopTarget, setLoopMutation, showToast]);

  const deleteLoop = useCallback((loopId: string) => {
    const target = resolveLoopTarget();
    if (!target || !loopId) {
      return;
    }
    void clearLoopMutation
      .mutateAsync({
        sessionId: target.sessionId,
        workspaceId: target.workspaceId,
        loopId,
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        logLatency("session.loop.clear.failed", { sessionId: target.sessionId, loopId, message });
        showToast(`Failed to delete loop: ${message}`);
      });
  }, [clearLoopMutation, resolveLoopTarget, showToast]);

  const pendingWrite = setLoopMutation.isPending || clearLoopMutation.isPending;

  return useMemo(() => ({
    armLoop,
    deleteLoop,
    pendingWrite,
  }), [armLoop, deleteLoop, pendingWrite]);
}
