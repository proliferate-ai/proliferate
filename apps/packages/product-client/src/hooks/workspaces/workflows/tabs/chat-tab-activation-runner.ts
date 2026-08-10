import {
  type SessionActivationGuard,
  type SessionActivationOutcome,
  isSessionActivationCurrent,
} from "#product/hooks/sessions/workflows/session-activation-guard";
import { useSessionSelectionActions } from "#product/hooks/sessions/facade/use-session-selection-actions";
import type { PendingChatActivation } from "#product/lib/domain/workspaces/tabs/shell-activation";
import {
  finishOrCancelMeasurementOperation,
  recordMeasurementWorkflowStep,
} from "#product/lib/infra/measurement/measurement-port";
import type { MeasurementOperationId } from "#product/lib/domain/telemetry/debug-measurement-catalog";
import { clearPendingHotSwitchMeasurement } from "#product/hooks/workspaces/workflows/tabs/workspace-shell-activation-measurement";
import type {
  SelectSessionOptionsWithoutGuard,
} from "#product/hooks/workspaces/workflows/tabs/workspace-shell-activation-types";
import { chatWorkspaceShellTabKey } from "#product/lib/domain/workspaces/tabs/shell-tabs";
import { useWorkspaceUiStore } from "#product/stores/preferences/workspace-ui-store";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";

type WorkspaceUiStoreState = ReturnType<typeof useWorkspaceUiStore.getState>;

export async function runDeferredChatTabActivation({
  clearPendingChatActivation,
  guard,
  hotOperationId,
  pending,
  replaceShellIntent,
  requestedSessionId,
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
  pending: PendingChatActivation;
  replaceShellIntent: WorkspaceUiStoreState["replaceShellIntent"];
  requestedSessionId: string;
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

  const resolvedSessionId =
    useSessionDirectoryStore.getState()
      .clientSessionIdByMaterializedSessionId[requestedSessionId]
    ?? requestedSessionId;
  const resolvedIntent = chatWorkspaceShellTabKey(resolvedSessionId);
  const resolvedPending = resolvedSessionId === sessionId
    ? pending
    : {
      ...pending,
      sessionId: resolvedSessionId,
      intent: resolvedIntent,
    };
  if (resolvedPending !== pending) {
    useWorkspaceUiStore.getState().setPendingChatActivation({
      workspaceId: shellStateKey,
      pending: resolvedPending,
    });
  }

  const durableStartedAt = performance.now();
  const previousWrite = writeShellIntent({
    workspaceId: shellStateKey,
    intent: resolvedIntent,
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
    const outcome = await guardedSelectSession(resolvedSessionId, {
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
        intent: resolvedIntent,
        pending: resolvedPending,
        previousWrite,
        rollbackShellIntent,
        shellStateKey,
      });
      clearMatchingPending({
        clearPendingChatActivation,
        hotOperationId,
        pending: resolvedPending,
        shellStateKey,
        step: "workspace.shell.pending_clear",
      });
      return outcome;
    }

    let completedPending = resolvedPending;
    if (outcome?.result === "completed" && outcome.sessionId !== resolvedSessionId) {
      const completedIntent = chatWorkspaceShellTabKey(outcome.sessionId);
      const currentPending = useWorkspaceUiStore.getState()
        .pendingChatActivationByWorkspace[shellStateKey] ?? null;
      if (currentPending?.attemptId === resolvedPending.attemptId) {
        const replacement = replaceShellIntent({
          workspaceId: shellStateKey,
          expectedIntent: resolvedIntent,
          expectedEpoch: previousWrite.epoch,
          nextIntent: completedIntent,
        });
        if (replacement.replaced || replacement.currentIntent === completedIntent) {
          completedPending = {
            ...resolvedPending,
            sessionId: outcome.sessionId,
            intent: completedIntent,
          };
          useWorkspaceUiStore.getState().setPendingChatActivation({
            workspaceId: shellStateKey,
            pending: completedPending,
          });
        }
      }
    }

    clearMatchingPending({
      clearPendingChatActivation,
      hotOperationId,
      pending: completedPending,
      shellStateKey,
      step: "workspace.shell.pending_clear",
    });
    return outcome ?? {
      result: "completed",
      sessionId: resolvedSessionId,
      guard,
      activeSessionVersion: useSessionSelectionStore.getState().activeSessionVersion,
    };
  } catch (error) {
    rollbackPendingDurableIntent({
      hotOperationId,
      intent: resolvedIntent,
      pending: resolvedPending,
      previousWrite,
      rollbackShellIntent,
      shellStateKey,
    });
    clearMatchingPending({
      clearPendingChatActivation,
      hotOperationId,
      pending: resolvedPending,
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
