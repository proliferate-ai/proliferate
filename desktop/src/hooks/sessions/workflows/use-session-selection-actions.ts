import { useCallback } from "react";
import type { WorkspaceSession } from "@/hooks/access/anyharness/sessions/use-workspace-session-cache";
import {
  commitActiveSession,
  commitHotActiveSession,
  isSessionActivationCurrent,
  type SessionActivationOutcome,
} from "@/hooks/sessions/workflows/session-activation-guard";
import type { SessionLatencyFlowOptions } from "@/hooks/sessions/workflows/session-selection-options";
import { resolveStatusFromExecutionSummary } from "@/lib/domain/sessions/activity";
import { resolveTrustedSessionSelectionRelationship } from "@/lib/domain/sessions/selection/trusted-session-selection";
import { isHotReopenEligibleSessionSlot } from "@/lib/domain/workspaces/selection/hot-reopen";
import { resolveWorkspaceUiKey } from "@/lib/domain/workspaces/selection/workspace-ui-key";
import {
  elapsedMs,
  logLatency,
  startLatencyTimer,
} from "@/lib/infra/measurement/debug-latency";
import {
  finishOrCancelMeasurementOperation,
  finishMeasurementOperation,
  markOperationForNextCommit,
  recordMeasurementMetric,
  recordMeasurementWorkflowStep,
  startMeasurementOperation,
} from "@/lib/infra/measurement/debug-measurement";
import { HOT_PAINT_MEASUREMENT_SUMMARY_BUDGET } from "@/lib/domain/telemetry/debug-measurement-catalog";
import { annotateLatencyFlow } from "@/lib/infra/measurement/latency-flow";
import { scheduleAfterNextPaint } from "@/lib/infra/scheduling/schedule-after-next-paint";
import { rememberLastViewedSession } from "@/stores/preferences/workspace-ui-store";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import {
  createEmptySessionRecord,
  getSessionRecord,
  isPendingSessionId,
  patchSessionRecord,
  putSessionRecord,
} from "@/stores/sessions/session-records";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import type {
  SessionChildRelationship,
  SessionRelationship,
} from "@/lib/domain/sessions/directory/relationship";
import { useWorkspaceRuntimeBlock } from "@/hooks/workspaces/derived/use-workspace-runtime-block";

interface UseSessionSelectionWorkflowActionsOptions {
  activateSession: (sessionId: string) => void;
  ensureWorkspaceSessions: (
    workspaceId: string,
    options?: SessionLatencyFlowOptions,
  ) => Promise<WorkspaceSession[]>;
}

export function classifyTrustedSessionSelection(sessionId: string): SessionRelationship {
  const state = useSessionDirectoryStore.getState();
  const slot = state.entriesById[sessionId] ?? null;
  const relationshipHint =
    state.relationshipHintsBySessionId[sessionId] as SessionChildRelationship | undefined;

  const plan = resolveTrustedSessionSelectionRelationship<
    SessionRelationship,
    SessionChildRelationship
  >({
    currentRelationship: slot?.sessionRelationship ?? null,
    relationshipHint,
    rootRelationship: { kind: "root" },
  });

  if (plan.commitAction === "promote_root") {
    state.setSessionRelationship(sessionId, plan.relationship);
  } else if (plan.commitAction === "apply_hint") {
    state.recordRelationshipHint(sessionId, plan.relationship);
  }
  return plan.relationship;
}

export function useSessionSelectionWorkflowActions({
  activateSession,
  ensureWorkspaceSessions,
}: UseSessionSelectionWorkflowActionsOptions) {
  const { getWorkspaceRuntimeBlockReason } = useWorkspaceRuntimeBlock();

  const selectSession = useCallback(async (
    sessionId: string,
    options?: SessionLatencyFlowOptions,
  ): Promise<SessionActivationOutcome | void> => {
    const guard = options?.guard ?? null;
    const commitSelection = (): SessionActivationOutcome | null => {
      if (!guard) {
        activateSession(sessionId);
        return null;
      }
      const outcome = commitActiveSession(sessionId, guard);
      return outcome;
    };
    const staleSelection = (
      reason: Extract<SessionActivationOutcome, { result: "stale" }>["reason"],
    ): SessionActivationOutcome | void => {
      if (measurementOperationId) {
        finishMeasurementOperation(measurementOperationId, "aborted");
      }
      return guard
        ? { result: "stale", sessionId, guard, reason }
        : undefined;
    };
    const startedAt = startLatencyTimer();
    const measurementOperationId = options?.reuseMeasurementOperation
      ? options.measurementOperationId ?? null
      : startMeasurementOperation({
        kind: "session_switch",
        surfaces: [
          "workspace-shell",
          "chat-surface",
          "session-transcript-pane",
          "transcript-list",
          "header-tabs",
          "workspace-sidebar",
        ],
        linkedLatencyFlowId: options?.latencyFlowId ?? undefined,
        maxDurationMs: 30_000,
      });
    const current = useSessionSelectionStore.getState();
    let existingSlot = getSessionRecord(sessionId);
    logLatency("session.select.start", {
      sessionId,
      flowId: options?.latencyFlowId ?? null,
      hasExistingSlot: existingSlot !== null,
      existingSlotWorkspaceId: existingSlot?.workspaceId ?? null,
      existingSlotMaterializedSessionId: existingSlot?.materializedSessionId ?? null,
      existingSlotTranscriptHydrated: existingSlot?.transcriptHydrated ?? null,
      existingSlotStatus: existingSlot?.status ?? null,
      existingSlotStreamConnectionState: existingSlot?.streamConnectionState ?? null,
      existingSlotPendingInteractionCount: existingSlot?.transcript.pendingInteractions.length ?? null,
      selectedWorkspaceId: current.selectedWorkspaceId,
    });
    if (guard && !isSessionActivationCurrent(guard)) {
      return staleSelection("intent-replaced");
    }

    const sessionSelectionRelationship = classifyTrustedSessionSelection(sessionId);
    if (existingSlot?.sessionRelationship.kind === "pending") {
      existingSlot = {
        ...existingSlot,
        sessionRelationship: sessionSelectionRelationship,
      };
    }

    if (existingSlot) {
      annotateLatencyFlow(options?.latencyFlowId, {
        targetSessionId: sessionId,
        targetWorkspaceId: existingSlot.workspaceId,
      });
      const canHotSwitch = !options?.forceCold
        && !!existingSlot.workspaceId
        && isHotReopenEligibleSessionSlot(
          existingSlot,
          existingSlot.workspaceId,
          isPendingSessionId,
        );
      if (canHotSwitch) {
        const hotStartedAt = performance.now();
        const hotOperationId = options?.reuseMeasurementOperation
          ? measurementOperationId
          : startMeasurementOperation({
            kind: "session_hot_switch",
            surfaces: [
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
            ],
            linkedLatencyFlowId: options?.latencyFlowId ?? undefined,
            maxDurationMs: 2500,
            summaryBudget: HOT_PAINT_MEASUREMENT_SUMMARY_BUDGET,
          });
        const gateState = useSessionSelectionStore.getState();
        const previousHotOperationId = gateState.hotPaintGate?.operationId ?? null;
        if (previousHotOperationId && previousHotOperationId !== hotOperationId) {
          finishOrCancelMeasurementOperation(previousHotOperationId, "aborted");
        }
        const nonce = gateState.workspaceSelectionNonce;
        const hotPaintGate = {
          workspaceId: existingSlot.workspaceId!,
          sessionId,
          nonce,
          operationId: hotOperationId,
          kind: "session_hot_switch",
        } as const;
        const commitOutcome = guard
          ? commitHotActiveSession(sessionId, guard, hotPaintGate)
          : (useSessionSelectionStore.getState().activateHotSession({
            sessionId,
            hotPaintGate,
          }), null);
        if (commitOutcome?.result === "stale") {
          finishOrCancelMeasurementOperation(hotOperationId, "aborted");
          return commitOutcome;
        }
        recordMeasurementWorkflowStep({
          operationId: hotOperationId,
          step: "session.select.hot_slot_activate",
          startedAt: hotStartedAt,
          outcome: existingSlot.transcriptHydrated ? "cache_hit" : "cache_miss",
        });
        logLatency("session.select.hot_slot_activate", {
          sessionId,
          workspaceId: existingSlot.workspaceId,
          materializedSessionId: existingSlot.materializedSessionId,
          transcriptHydrated: existingSlot.transcriptHydrated,
          status: existingSlot.status,
          streamConnectionState: existingSlot.streamConnectionState,
          pendingInteractionCount: existingSlot.transcript.pendingInteractions.length,
          flowId: options?.latencyFlowId ?? null,
        });
        if (hotOperationId) {
          markOperationForNextCommit(hotOperationId, [
            "workspace-shell",
            "chat-surface",
            "session-transcript-pane",
            "transcript-list",
            "header-tabs",
            "workspace-sidebar",
          ]);
        }
        scheduleAfterNextPaint(() => {
          const currentState = useSessionSelectionStore.getState();
          if (
            currentState.hotPaintGate?.nonce !== nonce
            || currentState.activeSessionId !== sessionId
          ) {
            finishOrCancelMeasurementOperation(hotOperationId, "aborted");
            return;
          }
          currentState.clearHotPaintGate(nonce);
          if (hotOperationId) {
            finishMeasurementOperation(hotOperationId, "completed");
          }
          const selection = useSessionSelectionStore.getState();
          const viewedSessionId = existingSlot.materializedSessionId ?? sessionId;
          rememberLastViewedSession(
            resolveWorkspaceUiKey(
              selection.selectedLogicalWorkspaceId,
              existingSlot.workspaceId!,
            ) ?? existingSlot.workspaceId!,
            viewedSessionId,
          );
        });
        if (measurementOperationId && measurementOperationId !== hotOperationId) {
          finishMeasurementOperation(measurementOperationId, "completed");
        }
        return commitOutcome ?? undefined;
      }
      const activateStartedAt = performance.now();
      const commitOutcome = commitSelection();
      if (commitOutcome?.result === "stale") {
        return commitOutcome;
      }
      recordMeasurementWorkflowStep({
        operationId: measurementOperationId,
        step: "session.select.hot_slot_activate",
        startedAt: activateStartedAt,
        outcome: existingSlot.transcriptHydrated ? "cache_hit" : "cache_miss",
      });
      if (
        existingSlot.streamConnectionState === "connecting"
        || existingSlot.streamConnectionState === "open"
      ) {
        logLatency("session.select.reused_live_slot", {
          sessionId,
          workspaceId: existingSlot.workspaceId,
          streamConnectionState: existingSlot.streamConnectionState,
          flowId: options?.latencyFlowId ?? null,
          totalElapsedMs: elapsedMs(startedAt),
        });
        if (measurementOperationId) {
          finishMeasurementOperation(measurementOperationId, "completed");
        }
        return commitOutcome ?? undefined;
      }
    }

    const workspaceId = existingSlot?.workspaceId ?? current.selectedWorkspaceId;
    if (!workspaceId) {
      throw new Error("No workspace selected");
    }
    annotateLatencyFlow(options?.latencyFlowId, {
      targetSessionId: sessionId,
      targetWorkspaceId: workspaceId,
    });

    const blockedReason = getWorkspaceRuntimeBlockReason(workspaceId);
    if (blockedReason && existingSlot) {
      const commitOutcome = commitSelection();
      if (commitOutcome?.result === "stale") {
        return commitOutcome;
      }
      if (measurementOperationId) {
        finishMeasurementOperation(measurementOperationId, "completed");
      }
      return commitOutcome ?? undefined;
    }
    if (blockedReason) {
      throw new Error(blockedReason);
    }

    const sessionsLoadStartedAt = startLatencyTimer();
    const sessions = await ensureWorkspaceSessions(workspaceId, {
      ...options,
      measurementOperationId,
    });
    recordMeasurementWorkflowStep({
      operationId: measurementOperationId,
      step: "session.select.ensure_sessions",
      startedAt: sessionsLoadStartedAt,
      count: sessions.length,
    });
    logLatency("session.select.sessions_loaded", {
      sessionId,
      workspaceId,
      sessionCount: sessions.length,
      flowId: options?.latencyFlowId ?? null,
      elapsedMs: elapsedMs(sessionsLoadStartedAt),
      totalElapsedMs: elapsedMs(startedAt),
    });
    const sessionMeta = sessions.find((session) => session.id === sessionId) ?? null;
    const agentKind = existingSlot?.agentKind ?? sessionMeta?.agentKind ?? "unknown";

    if (!existingSlot) {
      const storeStartedAt = performance.now();
      putSessionRecord({
        ...createEmptySessionRecord(sessionId, agentKind, {
          workspaceId,
          modelId: sessionMeta?.modelId ?? null,
          modeId: sessionMeta?.modeId ?? null,
          title: sessionMeta?.title ?? null,
          liveConfig: sessionMeta?.liveConfig ?? null,
          executionSummary: sessionMeta?.executionSummary ?? null,
          mcpBindingSummaries: sessionMeta?.mcpBindingSummaries ?? null,
          lastPromptAt: sessionMeta?.lastPromptAt ?? null,
          sessionRelationship: sessionSelectionRelationship,
        }),
        status: resolveStatusFromExecutionSummary(
          sessionMeta?.executionSummary ?? null,
          sessionMeta?.status ?? "idle",
        ),
      });
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
        outcome: "cache_miss",
      });
      const commitOutcome = commitSelection();
      if (commitOutcome?.result === "stale") {
        return commitOutcome;
      }
    } else {
      const storeStartedAt = performance.now();
      patchSessionRecord(sessionId, {
        workspaceId,
        agentKind,
        modelId: sessionMeta?.modelId ?? existingSlot.modelId ?? null,
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
        outcome: "cache_hit",
      });
    }

    const completedSlot = getSessionRecord(sessionId);
    logLatency("session.select.completed", {
      sessionId,
      workspaceId,
      flowId: options?.latencyFlowId ?? null,
      materializedSessionId: completedSlot?.materializedSessionId ?? null,
      transcriptHydrated: completedSlot?.transcriptHydrated ?? null,
      status: completedSlot?.status ?? null,
      streamConnectionState: completedSlot?.streamConnectionState ?? null,
      pendingInteractionCount: completedSlot?.transcript.pendingInteractions.length ?? null,
      totalElapsedMs: elapsedMs(startedAt),
    });
    if (measurementOperationId) {
      markOperationForNextCommit(measurementOperationId, [
        "workspace-shell",
        "chat-surface",
        "session-transcript-pane",
        "transcript-list",
        "header-tabs",
        "workspace-sidebar",
      ]);
      finishMeasurementOperation(measurementOperationId, "completed");
    }
    if (guard) {
      return {
        result: "completed",
        sessionId,
        guard,
        activeSessionVersion: useSessionSelectionStore.getState().activeSessionVersion,
      };
    }
  }, [
    activateSession,
    ensureWorkspaceSessions,
    getWorkspaceRuntimeBlockReason,
  ]);

  return { selectSession };
}
