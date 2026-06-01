import {
  type SessionActivationGuard,
  type SessionActivationOutcome,
  isSessionActivationCurrent,
} from "@/hooks/sessions/workflows/session-activation-guard";
import { useSessionSelectionActions } from "@/hooks/sessions/facade/use-session-selection-actions";
import type { PendingChatActivation } from "@/lib/domain/workspaces/tabs/shell-activation";
import {
  finishOrCancelMeasurementOperation,
  recordMeasurementWorkflowStep,
} from "@/lib/infra/measurement/debug-measurement";
import type { MeasurementOperationId } from "@/lib/domain/telemetry/debug-measurement-catalog";
import { clearPendingHotSwitchMeasurement } from "@/hooks/workspaces/workflows/tabs/workspace-shell-activation-measurement";
import type {
  SelectSessionOptionsWithoutGuard,
} from "@/hooks/workspaces/workflows/tabs/workspace-shell-activation-types";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";

type WorkspaceUiStoreState = ReturnType<typeof useWorkspaceUiStore.getState>;

export async function runDeferredChatTabActivation({
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
