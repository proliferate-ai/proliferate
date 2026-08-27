import type {
  SessionEventEnvelope,
  SessionLiveConfigSnapshot,
  TranscriptState,
} from "@anyharness/sdk";
import {
  type PendingSessionConfigChange,
  type PendingSessionConfigChanges,
} from "#product/domain/sessions/pending-config";
import {
  planBatchedStreamSideEffects,
  type ReconciledStreamConfigIntent,
} from "#product/lib/domain/sessions/stream/stream-side-effect-plan";
import {
  trackSessionInteraction,
  trackWorkspaceInteraction,
} from "#product/stores/preferences/workspace-ui-store";
import { useSlashCommandCatalogStore } from "#product/stores/chat/slash-command-catalog-store";
import {
  notifyTurnEnd,
  notifyUserFacingTurnEnd,
} from "#product/lib/infra/events/turn-end-events";
import type {
  SessionChildRelationship,
  SessionRelationship,
} from "#product/lib/domain/sessions/directory/relationship";
import {
  clearPendingConfigRollbackCheck,
} from "#product/hooks/sessions/lifecycle/session-runtime-pending-config";
import type { MeasurementOperationId } from "#product/lib/domain/telemetry/debug-measurement-catalog";
import type { SessionStreamCache } from "#product/hooks/sessions/cache/use-session-stream-cache";
import {
  createLatestTimestampThrottle,
} from "#product/lib/domain/sessions/stream/latest-timestamp-throttle";
import { relaySeatLimitHit } from "#product/lib/access/cloud/seat-limit-report";

const STREAM_WORKSPACE_ACTIVITY_WRITE_INTERVAL_MS = 1_000;

const streamWorkspaceInteractionThrottle = createLatestTimestampThrottle({
  intervalMs: STREAM_WORKSPACE_ACTIVITY_WRITE_INTERVAL_MS,
  write: trackWorkspaceInteraction,
});

const streamSessionInteractionThrottle = createLatestTimestampThrottle({
  intervalMs: STREAM_WORKSPACE_ACTIVITY_WRITE_INTERVAL_MS,
  write: trackSessionInteraction,
});

export function applyBatchedStreamSideEffects(input: {
  sessionStreamCache: SessionStreamCache;
  /** ProductClient session key used by local activity/transcript stores. */
  sessionId: string;
  /** Durable runtime parent ID used by roster APIs and relationship provenance. */
  materializedSessionId: string;
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
  resolveClientSessionId: (materializedSessionId: string) => string | null;
  markSessionPromoted: (
    sessionIds: readonly string[],
    workspaceId: string | null,
  ) => void;
  getSessionRelationship: (sessionId: string) => SessionRelationship | null;
  acknowledgeWorkspaceActivity?: (workspaceId: string, timestamp: string) => void;
  persistReconciledControlPreferences: (
    workspaceId: string | null | undefined,
    agentKind: string | null | undefined,
    liveConfig: SessionLiveConfigSnapshot,
    reconciledChanges: PendingSessionConfigChange[],
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
    sessionId: input.materializedSessionId,
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
        input.recordSessionRelationshipHint(
          input.resolveClientSessionId(effect.sessionId) ?? effect.sessionId,
          effect.relationship,
        );
        break;
      case "mount_subagent_child_session": {
        const clientSessionId = input.resolveClientSessionId(effect.childSessionId);
        void input.mountSubagentChildSession({
          childSessionId: clientSessionId ?? effect.childSessionId,
          label: effect.label,
          workspaceId: effect.workspaceId,
          parentSessionId: effect.parentSessionId,
          sessionLinkId: effect.sessionLinkId,
          requestHeaders: input.requestHeaders,
        });
        break;
      }
      case "mark_session_promoted": {
        const clientSessionId = input.resolveClientSessionId(effect.durableSessionId)
          ?? effect.durableSessionId;
        input.markSessionPromoted(
          [...new Set([effect.durableSessionId, clientSessionId])],
          effect.workspaceId,
        );
        break;
      }
      case "report_seat_limit_hit":
        // Fire-and-forget courier relay (agent_auth §4 cell 3): dedupe and
        // failure-swallowing live in the relay; nothing here awaits it.
        relaySeatLimitHit({
          sessionId: effect.sessionId,
          seq: effect.seq,
          seatId: effect.seatId,
          window: effect.window,
          resetAt: effect.resetAt,
        });
        break;
    }
  }

  if (plan.recordAvailableCommandsCatalog && input.agentKind) {
    useSlashCommandCatalogStore.getState().recordCatalog(
      input.agentKind,
      input.transcript.availableCommands,
    );
  }

  for (const intent of plan.persistReconciledControlPreferences) {
    input.persistReconciledControlPreferences(
      input.workspaceId,
      input.agentKind,
      intent.liveConfig,
      intent.reconciledChanges,
    );
  }

  if (plan.invalidateWorkspaceCollections) {
    input.sessionStreamCache.invalidateWorkspaceCollections(input.runtimeUrl);
  }
  if (plan.lastActivityTimestamp && input.workspaceId) {
    trackWorkspaceInteractionFromStream(input.workspaceId, plan.lastActivityTimestamp);
    input.acknowledgeWorkspaceActivity?.(input.workspaceId, plan.lastActivityTimestamp);
  }
  if (plan.lastActivityTimestamp) {
    trackSessionInteractionFromStream(input.sessionId, plan.lastActivityTimestamp);
  }
  if (plan.invalidateSessionSubagents) {
    input.sessionStreamCache.invalidateSessionSubagents({
      workspaceId: input.workspaceId,
      sessionId: input.materializedSessionId,
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
      workspaceId: input.workspaceId,
      parentSessionId,
    });
  }
  if (plan.invalidateGitStatus && input.workspaceId) {
    input.sessionStreamCache.invalidateGitStatus({
      workspaceId: input.workspaceId,
    });
  }
  if (plan.invalidatePrStatus && input.workspaceId) {
    input.sessionStreamCache.refreshPrStatuses({
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

function trackSessionInteractionFromStream(sessionId: string, timestamp: string) {
  streamSessionInteractionThrottle.record(sessionId, timestamp);
}

export function resetStreamWorkspaceActivityForTests() {
  streamWorkspaceInteractionThrottle.reset();
  streamSessionInteractionThrottle.reset();
}
