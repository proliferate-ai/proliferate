import type {
  SessionEventEnvelope,
  TranscriptState,
} from "@anyharness/sdk";
import {
  getAuthoritativeConfigValue,
  type PendingSessionConfigChange,
  type PendingSessionConfigChanges,
} from "@/lib/domain/sessions/pending-config";
import {
  planBatchedStreamSideEffects,
  type ReconciledStreamConfigIntent,
} from "@/lib/domain/sessions/stream/stream-side-effect-plan";
import { trackWorkspaceInteraction } from "@/stores/preferences/workspace-ui-store";
import {
  notifyTurnEnd,
  notifyUserFacingTurnEnd,
} from "@/lib/infra/events/turn-end-events";
import type {
  SessionChildRelationship,
  SessionRelationship,
} from "@/lib/domain/sessions/directory/relationship";
import {
  clearPendingConfigRollbackCheck,
} from "@/hooks/sessions/lifecycle/session-runtime-pending-config";
import type { MeasurementOperationId } from "@/lib/domain/telemetry/debug-measurement-catalog";
import type { SessionStreamCache } from "@/hooks/sessions/cache/use-session-stream-cache";
import {
  createLatestTimestampThrottle,
} from "@/lib/domain/sessions/stream/latest-timestamp-throttle";

const STREAM_WORKSPACE_ACTIVITY_WRITE_INTERVAL_MS = 1_000;

const streamWorkspaceInteractionThrottle = createLatestTimestampThrottle({
  intervalMs: STREAM_WORKSPACE_ACTIVITY_WRITE_INTERVAL_MS,
  write: trackWorkspaceInteraction,
});

export function applyBatchedStreamSideEffects(input: {
  sessionStreamCache: SessionStreamCache;
  sessionId: string;
  runtimeUrl: string;
  workspaceId: string | null;
  agentKind: string | null;
  requestHeaders?: HeadersInit;
  envelopes: SessionEventEnvelope[];
  transcript: TranscriptState;
  pendingConfigChanges: PendingSessionConfigChanges;
  reconciledIntents: ReconciledStreamConfigIntent[];
  mountSubagentChildSession: (input: {
    childSessionId: string;
    label: string | null;
    workspaceId: string | null;
    parentSessionId: string | null;
    sessionLinkId?: string | null;
    requestHeaders?: HeadersInit;
  }) => Promise<void> | void;
  recordSessionRelationshipHint: (
    sessionId: string,
    relationship: SessionChildRelationship,
  ) => void;
  getSessionRelationship: (sessionId: string) => SessionRelationship | null;
  acknowledgeWorkspaceActivity?: (workspaceId: string, timestamp: string) => void;
  persistReconciledModePreferences: (
    workspaceId: string | null | undefined,
    agentKind: string | null | undefined,
    liveConfigRawConfigId: string | null | undefined,
    reconciledChanges: PendingSessionConfigChange[],
    liveConfigValueResolver: (rawConfigId: string) => string | null,
  ) => void;
  refreshSessionSlotMeta: (
    sessionId: string,
    options?: {
      resumeIfActive?: boolean;
      requestHeaders?: HeadersInit;
      measurementOperationId?: MeasurementOperationId | null;
      isCurrent?: () => boolean;
    },
  ) => Promise<void>;
  showToast: (message: string, type?: "error" | "info") => void;
  clearActiveSummaryRefreshTimer: () => void;
  scheduleActiveSummaryRefresh: () => void;
  scheduleStartupReadyRefresh: (
    reason: "stream_open" | "available_commands",
    delayMs: number,
  ) => void;
}) {
  const plan = planBatchedStreamSideEffects({
    sessionId: input.sessionId,
    workspaceId: input.workspaceId,
    envelopes: input.envelopes,
    transcript: input.transcript,
    pendingConfigChanges: input.pendingConfigChanges,
    reconciledIntents: input.reconciledIntents,
  });

  for (const effect of plan.eventEffects) {
    switch (effect.kind) {
      case "schedule_startup_ready_refresh":
        input.scheduleStartupReadyRefresh(effect.reason, effect.delayMs);
        break;
      case "record_session_relationship_hint":
        input.recordSessionRelationshipHint(effect.sessionId, effect.relationship);
        break;
      case "mount_subagent_child_session":
        void input.mountSubagentChildSession({
          childSessionId: effect.childSessionId,
          label: effect.label,
          workspaceId: effect.workspaceId,
          parentSessionId: effect.parentSessionId,
          sessionLinkId: effect.sessionLinkId,
          requestHeaders: input.requestHeaders,
        });
        break;
    }
  }

  for (const intent of plan.persistReconciledModePreferences) {
    input.persistReconciledModePreferences(
      input.workspaceId,
      input.agentKind,
      intent.liveConfig.normalizedControls.mode?.rawConfigId ?? null,
      intent.reconciledChanges,
      (rawConfigId) => getAuthoritativeConfigValue(intent.liveConfig, rawConfigId),
    );
  }

  if (plan.invalidateWorkspaceCollections) {
    input.sessionStreamCache.invalidateWorkspaceCollections(input.runtimeUrl);
  }
  if (plan.lastActivityTimestamp && input.workspaceId) {
    trackWorkspaceInteractionFromStream(input.workspaceId, plan.lastActivityTimestamp);
    input.acknowledgeWorkspaceActivity?.(input.workspaceId, plan.lastActivityTimestamp);
  }
  if (plan.invalidateSessionSubagents) {
    input.sessionStreamCache.invalidateSessionSubagents({
      runtimeUrl: input.runtimeUrl,
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
    });
  }
  if (plan.invalidateCowork) {
    input.sessionStreamCache.invalidateCoworkManagedWorkspaces({
      runtimeUrl: input.runtimeUrl,
      sessionId: input.sessionId,
    });
  }
  for (const parentSessionId of plan.reviewParentSessionIds) {
    input.sessionStreamCache.invalidateSessionReviews({
      runtimeUrl: input.runtimeUrl,
      workspaceId: input.workspaceId,
      parentSessionId,
    });
  }
  if (plan.invalidateGitStatus && input.workspaceId) {
    input.sessionStreamCache.invalidateGitStatus({
      runtimeUrl: input.runtimeUrl,
      workspaceId: input.workspaceId,
    });
  }

  for (const effect of plan.orderedEffects) {
    switch (effect.kind) {
      case "clear_pending_config_rollback":
        clearPendingConfigRollbackCheck(input.sessionId);
        break;
      case "schedule_active_summary_refresh":
        input.scheduleActiveSummaryRefresh();
        break;
      case "clear_active_summary_refresh":
        input.clearActiveSummaryRefreshTimer();
        break;
      case "notify_turn_end":
        notifyTurnEnd(input.sessionId, effect.eventType);
        if (input.getSessionRelationship(input.sessionId)?.kind === "root") {
          notifyUserFacingTurnEnd(input.sessionId, effect.eventType);
        }
        break;
    }
  }
}

function trackWorkspaceInteractionFromStream(workspaceId: string, timestamp: string) {
  streamWorkspaceInteractionThrottle.record(workspaceId, timestamp);
}

export function resetStreamWorkspaceActivityForTests() {
  streamWorkspaceInteractionThrottle.reset();
}
