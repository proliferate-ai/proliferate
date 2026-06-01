import {
  finishOrCancelMeasurementOperation,
  startMeasurementOperation,
} from "@/lib/infra/measurement/debug-measurement";
import {
  HOT_PAINT_MEASUREMENT_SUMMARY_BUDGET,
  type MeasurementOperationId,
  type MeasurementSurface,
} from "@/lib/domain/telemetry/debug-measurement-catalog";
import { isHotReopenEligibleSessionSlot } from "@/lib/domain/workspaces/selection/hot-reopen";
import {
  getSessionRecord,
  isPendingSessionId,
} from "@/stores/sessions/session-records";
import type {
  SelectSessionOptionsWithoutGuard,
} from "@/hooks/workspaces/workflows/tabs/workspace-shell-activation-types";

export const HOT_SWITCH_SURFACES = [
  "workspace-shell",
  "chat-surface",
  "session-transcript-pane",
  "transcript-list",
  "transcript-context-providers",
  "transcript-row-list-router",
  "transcript-virtualized-viewport",
  "transcript-full-list",
  "header-tabs",
  "workspace-sidebar",
] satisfies readonly MeasurementSurface[];

interface HotSwitchMeasurement {
  operationId: MeasurementOperationId | null;
  ownedByShellActivation: boolean;
  reuseInSelect: boolean;
}

const pendingHotSwitchMeasurementsByShellKey = new Map<
  string,
  {
    attemptId: string;
    operationId: MeasurementOperationId;
  }
>();

export function resolveHotSwitchMeasurement({
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
      summaryBudget: HOT_PAINT_MEASUREMENT_SUMMARY_BUDGET,
    }),
    ownedByShellActivation: true,
    reuseInSelect: true,
  };
}

export function replacePendingHotSwitchMeasurement({
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

export function clearPendingHotSwitchMeasurement({
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
