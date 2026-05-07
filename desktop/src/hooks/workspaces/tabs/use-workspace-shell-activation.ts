import { useCallback } from "react";
import {
  beginSessionActivationIntent,
  clearActiveSession,
  invalidateSessionActivationIntent,
  isSessionActivationCurrent,
  type SessionActivationGuard,
  type SessionActivationOutcome,
} from "@/hooks/sessions/session-activation-guard";
import {
  chatShellWorkspaceIntentKey,
  chatWorkspaceShellTabKey,
  viewerWorkspaceShellTabKey,
} from "@/lib/domain/workspaces/tabs/shell-tabs";
import type { PendingChatActivation } from "@/lib/domain/workspaces/tabs/shell-activation";
import { fileViewerTarget, type ViewerTarget } from "@/lib/domain/workspaces/viewer/viewer-target";
import { resolveWorkspaceShellStateKey } from "@/lib/domain/workspaces/selection/workspace-ui-key";
import { useWorkspaceViewerTabsStore } from "@/stores/editor/workspace-viewer-tabs-store";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useSessionActions } from "@/hooks/sessions/use-session-actions";
import {
  finishOrCancelMeasurementOperation,
  markOperationForNextCommit,
  recordMeasurementWorkflowStep,
  startMeasurementOperation,
  type MeasurementOperationId,
  type MeasurementSurface,
} from "@/lib/infra/measurement/debug-measurement";
import { scheduleAfterNextPaint } from "@/lib/infra/scheduling/schedule-after-next-paint";
import { isHotReopenEligibleSessionSlot } from "@/lib/domain/workspaces/selection/hot-reopen";
import { isPendingSessionId } from "@/lib/workflows/sessions/session-runtime";
import { getSessionRecord } from "@/stores/sessions/session-records";

const HOT_SWITCH_SURFACES = [
  "workspace-shell",
  "chat-surface",
  "session-transcript-pane",
  "transcript-list",
  "header-tabs",
  "workspace-sidebar",
] satisfies readonly MeasurementSurface[];

const pendingHotSwitchMeasurementsByShellKey = new Map<
  string,
  {
    attemptId: string;
    operationId: MeasurementOperationId;
  }
>();

export type ShellActivationOutcome =
  | { result: "completed"; surface: "viewer" | "chat-shell"; shellActivationEpoch: number }
  | { result: "stale"; surface: "viewer" | "chat-shell"; reason: "intent-replaced" | "workspace-changed" };

export interface SelectSessionOptionsWithoutGuard {
  latencyFlowId?: string | null;
  measurementOperationId?: MeasurementOperationId | null;
  reuseMeasurementOperation?: boolean;
  allowColdIdleNoStream?: boolean;
  forceCold?: boolean;
}

export function useWorkspaceShellActivation() {
  const setActiveViewerTarget = useWorkspaceViewerTabsStore((state) => state.setActiveTarget);
  const writeShellIntent = useWorkspaceUiStore((state) => state.writeShellIntent);
  const setPendingChatActivation = useWorkspaceUiStore((state) => state.setPendingChatActivation);
  const clearPendingChatActivation = useWorkspaceUiStore((state) => state.clearPendingChatActivation);
  const rollbackShellIntent = useWorkspaceUiStore((state) => state.rollbackShellIntent);
  const { selectSession } = useSessionActions();

  const activateViewerTarget = useCallback(({
    workspaceId,
    shellWorkspaceId,
    target,
  }: {
    workspaceId: string;
    shellWorkspaceId?: string | null;
    target: ViewerTarget;
    mode?: "focus-existing" | "open-or-focus";
  }): ShellActivationOutcome => {
    const shellStateKey = resolveCurrentShellStateKey(workspaceId, shellWorkspaceId);
    invalidateSessionActivationIntent(workspaceId);
    const targetKey = viewerWorkspaceShellTabKey(target);
    setActiveViewerTarget(targetKey);
    const write = writeShellIntent({
      workspaceId: shellStateKey,
      intent: targetKey,
    });
    clearCurrentPendingForWorkspace(shellStateKey);
    return {
      result: "completed",
      surface: "viewer",
      shellActivationEpoch: write.epoch,
    };
  }, [
    setActiveViewerTarget,
    writeShellIntent,
  ]);

  const activateFileTab = useCallback(({
    workspaceId,
    shellWorkspaceId,
    path,
    mode,
  }: {
    workspaceId: string;
    shellWorkspaceId?: string | null;
    path: string;
    mode?: "focus-existing" | "open-or-focus";
  }) => activateViewerTarget({
    workspaceId,
    shellWorkspaceId,
    target: fileViewerTarget(path),
    mode,
  }), [activateViewerTarget]);

  const activateChatShell = useCallback(({
    workspaceId,
    shellWorkspaceId,
  }: {
    workspaceId: string;
    shellWorkspaceId?: string | null;
    reason?: string;
  }): ShellActivationOutcome => {
    const shellStateKey = resolveCurrentShellStateKey(workspaceId, shellWorkspaceId);
    invalidateSessionActivationIntent(workspaceId);
    const write = writeShellIntent({
      workspaceId: shellStateKey,
      intent: chatShellWorkspaceIntentKey(),
    });
    clearActiveSession(workspaceId);
    clearCurrentPendingForWorkspace(shellStateKey);
    return {
      result: "completed",
      surface: "chat-shell",
      shellActivationEpoch: write.epoch,
    };
  }, [writeShellIntent]);

  const activateChatTab = useCallback(({
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
      const scheduledAt = performance.now();
      scheduleAfterNextPaint(() => {
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
          setPendingChatActivation,
          shellStateKey,
          writeShellIntent,
        }).then(resolve, reject);
      });
    });
  }, [
    clearPendingChatActivation,
    rollbackShellIntent,
    selectSession,
    setPendingChatActivation,
    writeShellIntent,
  ]);

  return {
    activateChatShell,
    activateChatTab,
    activateFileTab,
    activateViewerTarget,
  };
}

function clearCurrentPendingForWorkspace(workspaceId: string): void {
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

type WorkspaceUiStoreState = ReturnType<typeof useWorkspaceUiStore.getState>;

interface HotSwitchMeasurement {
  operationId: MeasurementOperationId | null;
  ownedByShellActivation: boolean;
  reuseInSelect: boolean;
}

function resolveHotSwitchMeasurement({
  workspaceId,
  sessionId,
  selection,
}: {
  workspaceId: string;
  sessionId: string;
  selection?: SelectSessionOptionsWithoutGuard;
}): HotSwitchMeasurement {
  if (selection?.measurementOperationId) {
    return {
      operationId: selection.measurementOperationId,
      ownedByShellActivation: false,
      reuseInSelect: false,
    };
  }

  const existingSlot = getSessionRecord(sessionId);
  const canMeasureHotSwitch = !selection?.forceCold
    && isHotReopenEligibleSessionSlot(
      existingSlot,
      workspaceId,
      isPendingSessionId,
    );
  if (!canMeasureHotSwitch) {
    return {
      operationId: null,
      ownedByShellActivation: false,
      reuseInSelect: false,
    };
  }

  return {
    operationId: startMeasurementOperation({
      kind: "session_hot_switch",
      surfaces: HOT_SWITCH_SURFACES,
      linkedLatencyFlowId: selection?.latencyFlowId ?? undefined,
      maxDurationMs: 2500,
    }),
    ownedByShellActivation: true,
    reuseInSelect: true,
  };
}

function replacePendingHotSwitchMeasurement({
  attemptId,
  measurement,
  shellStateKey,
}: {
  attemptId: string;
  measurement: HotSwitchMeasurement;
  shellStateKey: string;
}): void {
  const previous = pendingHotSwitchMeasurementsByShellKey.get(shellStateKey);
  if (previous && previous.operationId !== measurement.operationId) {
    finishOrCancelMeasurementOperation(previous.operationId, "aborted");
  }

  if (measurement.operationId && measurement.ownedByShellActivation) {
    pendingHotSwitchMeasurementsByShellKey.set(shellStateKey, {
      attemptId,
      operationId: measurement.operationId,
    });
    return;
  }

  pendingHotSwitchMeasurementsByShellKey.delete(shellStateKey);
}

function clearPendingHotSwitchMeasurement({
  attemptId,
  shellStateKey,
}: {
  attemptId: string;
  shellStateKey: string;
}): void {
  const current = pendingHotSwitchMeasurementsByShellKey.get(shellStateKey);
  if (current?.attemptId === attemptId) {
    pendingHotSwitchMeasurementsByShellKey.delete(shellStateKey);
  }
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
  setPendingChatActivation,
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
  selectSession: ReturnType<typeof useSessionActions>["selectSession"];
  selection?: SelectSessionOptionsWithoutGuard;
  sessionId: string;
  setPendingChatActivation: WorkspaceUiStoreState["setPendingChatActivation"];
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
  const durablePending = pending.shellEpochAtWrite === previousWrite.epoch
    ? pending
    : { ...pending, shellEpochAtWrite: previousWrite.epoch };
  if (durablePending !== pending) {
    setPendingChatActivation({
      workspaceId: shellStateKey,
      pending: durablePending,
    });
  }

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
        pending: durablePending,
        previousWrite,
        rollbackShellIntent,
        shellStateKey,
      });
      clearMatchingPending({
        clearPendingChatActivation,
        hotOperationId,
        pending: durablePending,
        shellStateKey,
        step: "workspace.shell.pending_clear",
      });
      return outcome;
    }

    clearMatchingPending({
      clearPendingChatActivation,
      hotOperationId,
      pending: durablePending,
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
      pending: durablePending,
      previousWrite,
      rollbackShellIntent,
      shellStateKey,
    });
    clearMatchingPending({
      clearPendingChatActivation,
      hotOperationId,
      pending: durablePending,
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

function resolveCurrentShellStateKey(
  workspaceId: string,
  shellWorkspaceId: string | null | undefined,
): string {
  return resolveWorkspaceShellStateKey({
    workspaceId,
    shellWorkspaceId,
    selectedWorkspaceId: useSessionSelectionStore.getState().selectedWorkspaceId,
    selectedLogicalWorkspaceId: useSessionSelectionStore.getState().selectedLogicalWorkspaceId,
  }) ?? workspaceId;
}
