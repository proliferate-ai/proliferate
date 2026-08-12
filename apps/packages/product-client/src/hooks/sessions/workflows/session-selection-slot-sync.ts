import type { WorkspaceSession } from "#product/hooks/access/anyharness/sessions/use-workspace-session-cache";
import { resolveStatusFromExecutionSummary } from "#product/domain/sessions/activity";
import type { SessionRelationship } from "#product/lib/domain/sessions/directory/relationship";
import type { MeasurementOperationId } from "#product/lib/domain/telemetry/debug-measurement-catalog";
import {
  recordMeasurementMetric,
  recordMeasurementWorkflowStep,
} from "#product/lib/infra/measurement/measurement-port";
import {
  createEmptySessionRecord,
  patchSessionRecord,
  putSessionRecord,
} from "#product/stores/sessions/session-records";
import type { SessionRuntimeRecord } from "#product/stores/sessions/session-types";

export function syncSessionSelectionSlot({
  existingSlot,
  materializedSessionId,
  measurementOperationId,
  sessionId,
  sessionMeta,
  sessionRelationship,
  workspaceId,
}: {
  existingSlot: SessionRuntimeRecord | null;
  materializedSessionId: string;
  measurementOperationId: MeasurementOperationId | null;
  sessionId: string;
  sessionMeta: WorkspaceSession | null;
  sessionRelationship: SessionRelationship;
  workspaceId: string;
}): void {
  const agentKind = existingSlot?.agentKind ?? sessionMeta?.agentKind ?? "unknown";
  const storeStartedAt = performance.now();

  if (!existingSlot) {
    putSessionRecord({
      ...createEmptySessionRecord(sessionId, agentKind, {
        workspaceId,
        materializedSessionId,
        modelId: sessionMeta?.modelId ?? null,
        requestedModelId: sessionMeta?.requestedModelId ?? sessionMeta?.modelId ?? null,
        modeId: sessionMeta?.modeId ?? null,
        title: sessionMeta?.title ?? null,
        liveConfig: sessionMeta?.liveConfig ?? null,
        executionSummary: sessionMeta?.executionSummary ?? null,
        mcpBindingSummaries: sessionMeta?.mcpBindingSummaries ?? null,
        lastPromptAt: sessionMeta?.lastPromptAt ?? null,
        sessionRelationship,
      }),
      status: resolveStatusFromExecutionSummary(
        sessionMeta?.executionSummary ?? null,
        sessionMeta?.status ?? "idle",
      ),
    });
  } else {
    patchSessionRecord(sessionId, {
      workspaceId,
      agentKind,
      modelId: sessionMeta?.modelId ?? existingSlot.modelId ?? null,
      requestedModelId:
        sessionMeta?.requestedModelId
        ?? sessionMeta?.modelId
        ?? existingSlot.requestedModelId
        ?? null,
      modeId: sessionMeta?.modeId ?? existingSlot.modeId ?? null,
      title: sessionMeta?.title ?? existingSlot.title ?? null,
      liveConfig: sessionMeta?.liveConfig ?? existingSlot.liveConfig ?? null,
      executionSummary: sessionMeta?.executionSummary ?? existingSlot.executionSummary ?? null,
      mcpBindingSummaries: sessionMeta?.mcpBindingSummaries ?? existingSlot.mcpBindingSummaries ?? null,
      status: resolveStatusFromExecutionSummary(
        sessionMeta?.executionSummary ?? existingSlot.executionSummary ?? null,
        sessionMeta?.status ?? existingSlot.status,
      ),
      lastPromptAt: sessionMeta?.lastPromptAt ?? existingSlot.lastPromptAt ?? null,
    });
  }

  if (measurementOperationId) {
    recordMeasurementMetric({
      type: "store",
      category: "session.list",
      operationId: measurementOperationId,
      durationMs: performance.now() - storeStartedAt,
    });
  }
  recordMeasurementWorkflowStep({
    operationId: measurementOperationId,
    step: "session.select.slot_store",
    startedAt: storeStartedAt,
    outcome: existingSlot ? "cache_hit" : "cache_miss",
  });
}
