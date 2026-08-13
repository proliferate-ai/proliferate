import {
  createTranscriptState,
  type Session,
} from "@anyharness/sdk";
import { useCallback } from "react";
import { shouldClearOptimisticPromptAfterSessionSummary } from "#product/domain/chats/pending-prompts/pending-prompts";
import {
  resolveSessionStatus,
} from "#product/domain/sessions/activity";
import {
  hasQueuedPendingConfigChanges,
  reconcilePendingConfigChanges,
  shouldAcceptAuthoritativeLiveConfig,
  type PendingSessionConfigChange,
} from "#product/domain/sessions/pending-config";
import {
  pendingConfigChangesForSessionIntents,
} from "#product/domain/sessions/intents/session-intent-selectors";
import {
  sessionIntentsForSession,
} from "#product/domain/sessions/intents/session-intent-state";
import { buildSessionSlotPatchFromSummary } from "#product/lib/domain/sessions/summary";
import { activityFromTranscript } from "#product/lib/domain/sessions/directory/directory-activity";
import { batchSessionStoreWrites } from "#product/lib/infra/scheduling/react-batching";
import { persistDefaultSessionControlPreference } from "#product/hooks/sessions/workflows/session-control-preferences";
import { clearPendingConfigRollbackCheck } from "#product/hooks/sessions/lifecycle/session-runtime-pending-config";
import { useWorkspaceSurfaceLookup } from "#product/hooks/workspaces/derived/use-workspace-surface-lookup";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { getSessionRecord } from "#product/stores/sessions/session-records";
import { useSessionTranscriptStore } from "#product/stores/sessions/session-transcript-store";
import { useSessionIntentStore } from "#product/stores/sessions/session-intent-store";
import { trackWorkspaceInteraction } from "#product/stores/preferences/workspace-ui-store";

/**
 * Owns applying authoritative session summaries to the session stores.
 * Stream connection and history hydration stay in the runtime/history hooks.
 */
export function useSessionSummaryActions() {
  const { getWorkspaceSurface } = useWorkspaceSurfaceLookup();

  const persistReconciledControlPreferences = useCallback((
    workspaceId: string | null | undefined,
    agentKind: string | null | undefined,
    liveConfig: NonNullable<Session["liveConfig"]>,
    reconciledChanges: PendingSessionConfigChange[],
  ) => {
    const workspaceSurface = getWorkspaceSurface(workspaceId);
    for (const change of reconciledChanges) {
      persistDefaultSessionControlPreference({
        agentKind,
        liveConfig,
        rawConfigId: change.rawConfigId,
        requestedValue: change.value,
        workspaceSurface,
      });
    }
  }, [getWorkspaceSurface]);

  const applySessionSummary = useCallback((
    sessionId: string,
    session: Session,
    workspaceId: string,
  ) => {
    const existing = getSessionRecord(sessionId);
    if (!existing) {
      return;
    }

    const patch = buildSessionSlotPatchFromSummary(
      session,
      workspaceId,
      existing.transcript ?? createTranscriptState(sessionId),
    );
    const shouldApplyLiveConfig = shouldAcceptAuthoritativeLiveConfig(
      existing.liveConfig,
      patch.liveConfig,
    );
    const shouldApplyConfigFields = shouldApplyLiveConfig || !existing.liveConfig;
    const effectiveLiveConfig = shouldApplyLiveConfig
      ? patch.liveConfig
      : existing.liveConfig;
    const nextTranscript = {
      ...patch.transcript,
      currentModeId: shouldApplyConfigFields
        ? patch.transcript.currentModeId
        : existing.transcript.currentModeId,
    };
    const intentPendingConfigChanges = pendingConfigChangesForSessionIntents(
      sessionIntentsForSession(useSessionIntentStore.getState(), sessionId),
    );
    const reconcileResult = reconcilePendingConfigChanges(
      effectiveLiveConfig,
      intentPendingConfigChanges,
    );

    const resolvedWorkspaceId = existing.workspaceId ?? workspaceId;
    const nextStatus = resolveSessionStatus(patch.status, {
      executionSummary: patch.executionSummary,
      streamConnectionState: existing.streamConnectionState,
      transcript: nextTranscript,
    });
    batchSessionStoreWrites(() => {
      useSessionDirectoryStore.getState().patchEntry(sessionId, {
        materializedSessionId: session.id,
        agentKind: patch.agentKind,
        workspaceId: patch.workspaceId,
        modelId: shouldApplyConfigFields ? patch.modelId : existing.modelId,
        requestedModelId: patch.requestedModelId,
        modeId: shouldApplyConfigFields ? patch.modeId : existing.modeId,
        // A null summary title means "not titled yet", never "clear": keep
        // the optimistic prompt-derived title until an assigned title lands.
        ...(patch.title != null ? { title: patch.title } : {}),
        actionCapabilities: patch.actionCapabilities,
        liveConfig: effectiveLiveConfig,
        executionSummary: patch.executionSummary,
        mcpBindingSummaries: patch.mcpBindingSummaries,
        activeGoal: patch.activeGoal,
        pendingConfigChanges: {},
        status: nextStatus,
        lastPromptAt: patch.lastPromptAt,
        activity: activityFromTranscript(nextTranscript, {
          status: nextStatus,
          executionSummary: patch.executionSummary,
        }),
      });
      useSessionTranscriptStore.getState().patchEntry(sessionId, {
        transcript: nextTranscript,
        optimisticPrompt:
          shouldClearOptimisticPromptAfterSessionSummary(patch.status)
            ? null
            : existing.optimisticPrompt,
      });
    });

    const interactionTimestamp =
      patch.executionSummary?.updatedAt
      ?? session.updatedAt
      ?? session.lastPromptAt
      ?? null;
    if (resolvedWorkspaceId && interactionTimestamp) {
      trackWorkspaceInteraction(resolvedWorkspaceId, interactionTimestamp);
    }

    if (effectiveLiveConfig) {
      persistReconciledControlPreferences(
        resolvedWorkspaceId,
        patch.agentKind,
        effectiveLiveConfig,
        reconcileResult.reconciledChanges,
      );
    }

    if (!hasQueuedPendingConfigChanges(reconcileResult.pendingConfigChanges)) {
      clearPendingConfigRollbackCheck(sessionId);
    }
  }, [persistReconciledControlPreferences]);

  return {
    applySessionSummary,
    persistReconciledControlPreferences,
  };
}
