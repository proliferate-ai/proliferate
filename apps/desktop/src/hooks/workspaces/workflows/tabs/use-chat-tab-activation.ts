import { useCallback } from "react";
import {
  beginSessionActivationIntent,
  type SessionActivationGuard,
  type SessionActivationOutcome,
} from "@/hooks/sessions/workflows/session-activation-guard";
import { useSessionSelectionActions } from "@/hooks/sessions/facade/use-session-selection-actions";
import { chatWorkspaceShellTabKey } from "@/lib/domain/workspaces/tabs/shell-tabs";
import {
  markOperationForNextCommit,
  recordMeasurementWorkflowStep,
} from "@/lib/infra/measurement/debug-measurement";
import { scheduleAfterNextPaint } from "@/lib/infra/scheduling/schedule-after-next-paint";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import {
  clearPendingHotSwitchMeasurement,
  HOT_SWITCH_SURFACES,
  replacePendingHotSwitchMeasurement,
  resolveHotSwitchMeasurement,
} from "@/hooks/workspaces/workflows/tabs/workspace-shell-activation-measurement";
import { resolveCurrentShellStateKey } from "@/hooks/workspaces/workflows/tabs/workspace-shell-state-key";
import type {
  SelectSessionOptionsWithoutGuard,
} from "@/hooks/workspaces/workflows/tabs/workspace-shell-activation-types";
import { runDeferredChatTabActivation } from "@/hooks/workspaces/workflows/tabs/chat-tab-activation-runner";

export type { SelectSessionOptionsWithoutGuard };

const CHAT_TAB_ACTIVATION_COALESCE_MS = 180;

const pendingDeferredChatActivationsByShellKey = new Map<
  string,
  {
    attemptId: string;
    cancel: () => void;
    guard: SessionActivationGuard;
    sessionId: string;
    resolve: (outcome: SessionActivationOutcome) => void;
  }
>();

export function useChatTabActivation() {
  const writeShellIntent = useWorkspaceUiStore((state) => state.writeShellIntent);
  const setPendingChatActivation = useWorkspaceUiStore((state) => state.setPendingChatActivation);
  const clearPendingChatActivation = useWorkspaceUiStore((state) => state.clearPendingChatActivation);
  const rollbackShellIntent = useWorkspaceUiStore((state) => state.rollbackShellIntent);
  const { selectSession } = useSessionSelectionActions();

  return useCallback(({
    workspaceId,
    shellWorkspaceId,
    sessionId,
    selection,
  }: {
    workspaceId: string;
    shellWorkspaceId?: string | null;
    sessionId: string;
    revealHidden?: boolean;
    source?: string;
    selection?: SelectSessionOptionsWithoutGuard;
  }): Promise<SessionActivationOutcome> => {
    const shellStateKey = resolveCurrentShellStateKey(workspaceId, shellWorkspaceId);
    const guard = beginSessionActivationIntent(workspaceId);
    const intent = chatWorkspaceShellTabKey(sessionId);
    const shellEpochAtWrite =
      useWorkspaceUiStore.getState().shellActivationEpochByWorkspace[shellStateKey] ?? 0;
    const pending = {
      attemptId: crypto.randomUUID(),
      sessionId,
      intent,
      guardToken: guard.token,
      workspaceSelectionNonce: guard.workspaceSelectionNonce,
      shellEpochAtWrite,
      sessionActivationEpochAtWrite: guard.token,
    };
    const hotMeasurement = resolveHotSwitchMeasurement({
      workspaceId,
      sessionId,
      selection,
    });
    const hotOperationId = hotMeasurement.operationId;
    replacePendingHotSwitchMeasurement({
      attemptId: pending.attemptId,
      measurement: hotMeasurement,
      shellStateKey,
    });
    const pendingStartedAt = performance.now();
    setPendingChatActivation({
      workspaceId: shellStateKey,
      pending,
    });
    recordMeasurementWorkflowStep({
      operationId: hotOperationId,
      step: "workspace.shell.pending_activation",
      startedAt: pendingStartedAt,
      outcome: "completed",
    });
    if (hotOperationId) {
      markOperationForNextCommit(hotOperationId, HOT_SWITCH_SURFACES);
    }

    return new Promise<SessionActivationOutcome>((resolve, reject) => {
      cancelPendingDeferredChatActivation(shellStateKey, "intent-replaced");
      const scheduledAt = performance.now();
      const cancel = scheduleCoalescedChatActivation(() => {
        const currentScheduled =
          pendingDeferredChatActivationsByShellKey.get(shellStateKey);
        if (currentScheduled?.attemptId === pending.attemptId) {
          pendingDeferredChatActivationsByShellKey.delete(shellStateKey);
        }
        recordMeasurementWorkflowStep({
          operationId: hotOperationId,
          step: "workspace.shell.after_paint",
          startedAt: scheduledAt,
          outcome: "completed",
        });
        void runDeferredChatTabActivation({
          clearPendingChatActivation,
          guard,
          hotOperationId,
          intent,
          pending,
          reuseHotOperationInSelect: hotMeasurement.reuseInSelect,
          rollbackShellIntent,
          selectSession,
          selection,
          sessionId,
          shellStateKey,
          writeShellIntent,
        }).then(resolve, reject);
      });
      pendingDeferredChatActivationsByShellKey.set(shellStateKey, {
        attemptId: pending.attemptId,
        cancel,
        guard,
        sessionId,
        resolve,
      });
    });
  }, [
    clearPendingChatActivation,
    rollbackShellIntent,
    selectSession,
    setPendingChatActivation,
    writeShellIntent,
  ]);
}

export function clearCurrentPendingForWorkspace(workspaceId: string): void {
  const pending = useWorkspaceUiStore.getState().pendingChatActivationByWorkspace[workspaceId];
  if (!pending) {
    return;
  }
  clearPendingHotSwitchMeasurement({
    attemptId: pending.attemptId,
    shellStateKey: workspaceId,
  });
  useWorkspaceUiStore.getState().clearPendingChatActivation({
    workspaceId,
    attemptId: pending.attemptId,
    bumpIfCurrent: false,
  });
}

export function cancelPendingDeferredChatActivation(
  shellStateKey: string,
  reason: Extract<SessionActivationOutcome, { result: "stale" }>["reason"],
): void {
  const scheduled = pendingDeferredChatActivationsByShellKey.get(shellStateKey);
  if (!scheduled) {
    return;
  }
  scheduled.cancel();
  pendingDeferredChatActivationsByShellKey.delete(shellStateKey);
  scheduled.resolve({
    result: "stale",
    sessionId: scheduled.sessionId,
    guard: scheduled.guard,
    reason,
  });
}

function scheduleCoalescedChatActivation(callback: () => void): () => void {
  let cancelled = false;
  let cancelAfterPaint: (() => void) | null = null;
  const timeoutId = window.setTimeout(() => {
    if (cancelled) {
      return;
    }
    cancelAfterPaint = scheduleAfterNextPaint(() => {
      if (!cancelled) {
        callback();
      }
    });
  }, CHAT_TAB_ACTIVATION_COALESCE_MS);

  return () => {
    cancelled = true;
    window.clearTimeout(timeoutId);
    cancelAfterPaint?.();
  };
}
