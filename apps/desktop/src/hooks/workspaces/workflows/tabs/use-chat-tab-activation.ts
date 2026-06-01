import { useCallback } from "react";
import {
  beginSessionActivationIntent,
  type SessionActivationGuard,
  type SessionActivationOutcome,
  isSessionActivationCurrent,
} from "@/hooks/sessions/workflows/session-activation-guard";
import { useSessionSelectionActions } from "@/hooks/sessions/facade/use-session-selection-actions";
import { chatWorkspaceShellTabKey } from "@/lib/domain/workspaces/tabs/shell-tabs";
import type { PendingChatActivation } from "@/lib/domain/workspaces/tabs/shell-activation";
import {
  finishOrCancelMeasurementOperation,
  markOperationForNextCommit,
  recordMeasurementWorkflowStep,
} from "@/lib/infra/measurement/debug-measurement";
import type { MeasurementOperationId } from "@/lib/domain/telemetry/debug-measurement-catalog";
import { scheduleAfterNextPaint } from "@/lib/infra/scheduling/schedule-after-next-paint";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
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

type WorkspaceUiStoreState = ReturnType<typeof useWorkspaceUiStore.getState>;

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

async function runDeferredChatTabActivation({
  clearPendingChatActivation,
  guard,
  hotOperationId,
  intent,
  pending,
  reuseHotOperationInSelect,
  rollbackShellIntent,
  selectSession,
  selection,
  sessionId,
  shellStateKey,
  writeShellIntent,
}: {
  clearPendingChatActivation: WorkspaceUiStoreState["clearPendingChatActivation"];
  guard: SessionActivationGuard;
  hotOperationId: MeasurementOperationId | null;
  intent: `chat:${string}`;
  pending: PendingChatActivation;
  reuseHotOperationInSelect: boolean;
  rollbackShellIntent: WorkspaceUiStoreState["rollbackShellIntent"];
  selectSession: ReturnType<typeof useSessionSelectionActions>["selectSession"];
  selection?: SelectSessionOptionsWithoutGuard;
  sessionId: string;
  shellStateKey: string;
  writeShellIntent: WorkspaceUiStoreState["writeShellIntent"];
}): Promise<SessionActivationOutcome> {
  if (!isPendingChatActivationStillCurrent(shellStateKey, pending, guard)) {
    clearMatchingPending({
      clearPendingChatActivation,
      hotOperationId,
      pending,
      shellStateKey,
      step: "workspace.shell.pending_clear",
    });
    finishOrCancelMeasurementOperation(hotOperationId, "aborted");
    return {
      result: "stale",
      sessionId,
      guard,
      reason: resolvePendingActivationStaleReason(guard),
    };
  }

  const durableStartedAt = performance.now();
  const previousWrite = writeShellIntent({
    workspaceId: shellStateKey,
    intent,
  });
  recordMeasurementWorkflowStep({
    operationId: hotOperationId,
    step: "workspace.shell.durable_intent",
    startedAt: durableStartedAt,
    outcome: previousWrite.changed ? "completed" : "skipped",
  });

  try {
    const guardedSelectSession = selectSession as (
      targetSessionId: string,
      targetOptions: SelectSessionOptionsWithoutGuard & { guard: SessionActivationGuard },
    ) => Promise<SessionActivationOutcome | void>;
    const selectStartedAt = performance.now();
    const outcome = await guardedSelectSession(sessionId, {
      ...selection,
      guard,
      measurementOperationId: hotOperationId ?? selection?.measurementOperationId ?? null,
      reuseMeasurementOperation: reuseHotOperationInSelect,
    });
    recordMeasurementWorkflowStep({
      operationId: hotOperationId,
      step: "workspace.shell.real_activation",
      startedAt: selectStartedAt,
      outcome: outcome?.result === "stale" ? "skipped" : "completed",
    });

    if (outcome?.result === "stale") {
      rollbackPendingDurableIntent({
        hotOperationId,
        intent,
        pending,
        previousWrite,
        rollbackShellIntent,
        shellStateKey,
      });
      clearMatchingPending({
        clearPendingChatActivation,
        hotOperationId,
        pending,
        shellStateKey,
        step: "workspace.shell.pending_clear",
      });
      return outcome;
    }

    clearMatchingPending({
      clearPendingChatActivation,
      hotOperationId,
      pending,
      shellStateKey,
      step: "workspace.shell.pending_clear",
    });
    return outcome ?? {
      result: "completed",
      sessionId,
      guard,
      activeSessionVersion: useSessionSelectionStore.getState().activeSessionVersion,
    };
  } catch (error) {
    rollbackPendingDurableIntent({
      hotOperationId,
      intent,
      pending,
      previousWrite,
      rollbackShellIntent,
      shellStateKey,
    });
    clearMatchingPending({
      clearPendingChatActivation,
      hotOperationId,
      pending,
      shellStateKey,
      step: "workspace.shell.pending_clear",
    });
    finishOrCancelMeasurementOperation(hotOperationId, "error_sanitized");
    throw error;
  }
}

function isPendingChatActivationStillCurrent(
  shellStateKey: string,
  pending: PendingChatActivation,
  guard: SessionActivationGuard,
): boolean {
  const workspaceUiState = useWorkspaceUiStore.getState();
  const currentPending =
    workspaceUiState.pendingChatActivationByWorkspace[shellStateKey] ?? null;
  const currentShellEpoch =
    workspaceUiState.shellActivationEpochByWorkspace[shellStateKey] ?? 0;
  return currentPending?.attemptId === pending.attemptId
    && currentShellEpoch === pending.shellEpochAtWrite
    && isSessionActivationCurrent(guard);
}

function resolvePendingActivationStaleReason(
  guard: SessionActivationGuard,
): Extract<SessionActivationOutcome, { result: "stale" }>["reason"] {
  const state = useSessionSelectionStore.getState();
  if (state.selectedWorkspaceId !== guard.workspaceId) {
    return "workspace-changed";
  }
  if (state.workspaceSelectionNonce !== guard.workspaceSelectionNonce) {
    return "selection-replaced";
  }
  return "intent-replaced";
}

function clearMatchingPending({
  clearPendingChatActivation,
  hotOperationId,
  pending,
  shellStateKey,
  step,
}: {
  clearPendingChatActivation: WorkspaceUiStoreState["clearPendingChatActivation"];
  hotOperationId: MeasurementOperationId | null;
  pending: PendingChatActivation;
  shellStateKey: string;
  step: "workspace.shell.pending_clear";
}): void {
  const clearStartedAt = performance.now();
  const result = clearPendingChatActivation({
    workspaceId: shellStateKey,
    attemptId: pending.attemptId,
    bumpIfCurrent: false,
  });
  recordMeasurementWorkflowStep({
    operationId: hotOperationId,
    step,
    startedAt: clearStartedAt,
    outcome: result.cleared ? "completed" : "skipped",
  });
  clearPendingHotSwitchMeasurement({
    attemptId: pending.attemptId,
    shellStateKey,
  });
}

function rollbackPendingDurableIntent({
  hotOperationId,
  intent,
  pending,
  previousWrite,
  rollbackShellIntent,
  shellStateKey,
}: {
  hotOperationId: MeasurementOperationId | null;
  intent: `chat:${string}`;
  pending: PendingChatActivation;
  previousWrite: ReturnType<WorkspaceUiStoreState["writeShellIntent"]>;
  rollbackShellIntent: WorkspaceUiStoreState["rollbackShellIntent"];
  shellStateKey: string;
}): void {
  const rollbackStartedAt = performance.now();
  const rollback = rollbackShellIntent({
    workspaceId: shellStateKey,
    expectedIntent: intent,
    expectedEpoch: previousWrite.epoch,
    expectedPendingAttemptId: pending.attemptId,
    rollbackIntent: previousWrite.previousIntent,
  });
  recordMeasurementWorkflowStep({
    operationId: hotOperationId,
    step: "workspace.shell.pending_rollback",
    startedAt: rollbackStartedAt,
    outcome: rollback.rolledBack ? "completed" : "skipped",
  });
}
