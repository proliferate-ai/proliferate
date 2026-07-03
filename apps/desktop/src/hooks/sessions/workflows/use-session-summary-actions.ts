import {
  createTranscriptState,
  type Session,
} from "@anyharness/sdk";
import { useCallback } from "react";
import { shouldClearOptimisticPromptAfterSessionSummary } from "@proliferate/product-domain/chats/pending-prompts/pending-prompts";
import {
  resolveSessionStatus,
} from "@proliferate/product-domain/sessions/activity";
import {
  getAuthoritativeConfigValue,
  hasQueuedPendingConfigChanges,
  reconcilePendingConfigChanges,
  shouldAcceptAuthoritativeLiveConfig,
  type PendingSessionConfigChange,
} from "@proliferate/product-domain/sessions/pending-config";
import {
  pendingConfigChangesForSessionIntents,
} from "@proliferate/product-domain/sessions/intents/session-intent-selectors";
import {
  sessionIntentsForSession,
} from "@proliferate/product-domain/sessions/intents/session-intent-state";
import { buildSessionSlotPatchFromSummary } from "@/lib/domain/sessions/summary";
import { activityFromTranscript } from "@/lib/domain/sessions/directory/directory-activity";
import { batchSessionStoreWrites } from "@/lib/infra/scheduling/react-batching";
import { persistDefaultSessionModePreference } from "@/hooks/sessions/workflows/session-mode-preferences";
import { clearPendingConfigRollbackCheck } from "@/hooks/sessions/lifecycle/session-runtime-pending-config";
import { useWorkspaceSurfaceLookup } from "@/hooks/workspaces/derived/use-workspace-surface-lookup";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import { getSessionRecord } from "@/stores/sessions/session-records";
import { useSessionTranscriptStore } from "@/stores/sessions/session-transcript-store";
import { useSessionIntentStore } from "@/stores/sessions/session-intent-store";
import { trackWorkspaceInteraction } from "@/stores/preferences/workspace-ui-store";

/**
 * Owns applying authoritative session summaries to the session stores.
 * Stream connection and history hydration stay in the runtime/history hooks.
 */
export function useSessionSummaryActions() {
  const { getWorkspaceSurface } = useWorkspaceSurfaceLookup();

  const persistReconciledModePreferences = useCallback((
    workspaceId: string | null | undefined,
    agentKind: string | null | undefined,
    liveConfigRawConfigId: string | null | undefined,
    reconciledChanges: PendingSessionConfigChange[],
    liveConfigValueResolver: (rawConfigId: string) => string | null,
  ) => {
    const workspaceSurface = getWorkspaceSurface(workspaceId);
    for (const change of reconciledChanges) {
      persistDefaultSessionModePreference({
        agentKind,
        liveConfigRawConfigId,
        rawConfigId: change.rawConfigId,
        modeId: liveConfigValueResolver(change.rawConfigId),
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
        title: patch.title,
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

    persistReconciledModePreferences(
      resolvedWorkspaceId,
      patch.agentKind,
      effectiveLiveConfig?.normalizedControls.mode?.rawConfigId ?? null,
      reconcileResult.reconciledChanges,
      (rawConfigId) => getAuthoritativeConfigValue(effectiveLiveConfig, rawConfigId),
    );

    if (!hasQueuedPendingConfigChanges(reconcileResult.pendingConfigChanges)) {
      clearPendingConfigRollbackCheck(sessionId);
    }
  }, [persistReconciledModePreferences]);

  return {
    applySessionSummary,
    persistReconciledModePreferences,
  };
}
