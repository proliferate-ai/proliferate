import {
  anyHarnessCoworkManagedWorkspacesKey,
  anyHarnessGitStatusKey,
  anyHarnessSessionReviewsKey,
  anyHarnessSessionSubagentsKey,
} from "@anyharness/sdk-react";
import type { QueryClient } from "@tanstack/react-query";
import type {
  SessionEventEnvelope,
  SessionLiveConfigSnapshot,
  ToolCallItem,
  TranscriptState,
} from "@anyharness/sdk";
import { workspaceCollectionsScopeKey } from "@/hooks/workspaces/query-keys";
import {
  getAuthoritativeConfigValue,
  hasQueuedPendingConfigChanges,
  type PendingSessionConfigChange,
  type PendingSessionConfigChanges,
} from "@/lib/domain/sessions/pending-config";
import {
  parseSubagentLaunchResult,
  resolveSubagentLaunchDisplay,
} from "@/lib/domain/chat/subagent-launch";
import { trackWorkspaceInteraction } from "@/stores/preferences/workspace-ui-store";
import {
  notifyTurnEnd,
  notifyUserFacingTurnEnd,
} from "@/lib/infra/events/turn-end-events";
import type {
  SessionChildRelationship,
  SessionRelationship,
} from "@/stores/sessions/session-types";
import {
  clearPendingConfigRollbackCheck,
  schedulePendingConfigRollbackCheck,
} from "@/hooks/sessions/session-runtime-pending-config";
import type { MeasurementOperationId } from "@/lib/infra/measurement/debug-measurement";

export interface ReconciledStreamConfigIntent {
  liveConfig: SessionLiveConfigSnapshot;
  reconciledChanges: PendingSessionConfigChange[];
}

type OrderedStreamSideEffect =
  | { kind: "clear_pending_config_rollback" }
  | { kind: "schedule_active_summary_refresh" }
  | { kind: "clear_active_summary_refresh" }
  | { kind: "schedule_pending_config_rollback" }
  | {
    kind: "notify_turn_end";
    eventType: "turn_ended" | "error";
  };

export function applyBatchedStreamSideEffects(input: {
  queryClient: QueryClient;
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
  let shouldInvalidateWorkspaceCollections = false;
  let shouldInvalidateGitStatus = false;
  let lastActivityTimestamp: string | null = null;
  let shouldInvalidateSessionSubagents = false;
  let shouldInvalidateCowork = false;
  const reviewParentSessionIds = new Set<string>();
  const orderedEffects: OrderedStreamSideEffect[] = [];

  for (const envelope of input.envelopes) {
    const event = envelope.event;
    if (event.type === "available_commands_update") {
      input.scheduleStartupReadyRefresh("available_commands", 0);
    }
    if (event.type === "turn_started" || event.type === "session_ended") {
      appendOrderedEffect(orderedEffects, { kind: "clear_pending_config_rollback" });
    }
    if (shouldScheduleActiveSummaryRefresh(event.type)) {
      appendOrderedEffect(orderedEffects, { kind: "schedule_active_summary_refresh" });
    }
    if (
      event.type === "turn_ended"
      || event.type === "error"
      || event.type === "session_ended"
    ) {
      appendOrderedEffect(orderedEffects, { kind: "clear_active_summary_refresh" });
    }
    if (
      event.type === "turn_started"
      || event.type === "interaction_requested"
      || event.type === "interaction_resolved"
      || event.type === "turn_ended"
      || event.type === "error"
      || event.type === "session_ended"
    ) {
      shouldInvalidateWorkspaceCollections = true;
    }
    if (input.workspaceId && shouldTrackWorkspaceWorkActivity(event.type)) {
      lastActivityTimestamp = envelope.timestamp;
    }
    if (event.type === "turn_ended" || event.type === "error") {
      shouldInvalidateGitStatus = !!input.workspaceId;
      if (hasQueuedPendingConfigChanges(input.pendingConfigChanges)) {
        appendOrderedEffect(orderedEffects, { kind: "schedule_pending_config_rollback" });
      }
      orderedEffects.push({
        kind: "notify_turn_end",
        eventType: event.type,
      });
    }
    if (event.type === "subagent_turn_completed") {
      input.recordSessionRelationshipHint(event.childSessionId, {
        kind: "subagent_child",
        parentSessionId: event.parentSessionId,
        sessionLinkId: event.sessionLinkId,
        relation: "subagent",
        workspaceId: input.workspaceId,
      });
      void input.mountSubagentChildSession({
        childSessionId: event.childSessionId,
        label: event.label ?? null,
        workspaceId: input.workspaceId,
        parentSessionId: event.parentSessionId,
        sessionLinkId: event.sessionLinkId,
        requestHeaders: input.requestHeaders,
      });
      shouldInvalidateSessionSubagents = true;
    }
    if (
      event.type === "session_link_turn_completed"
      && event.relation === "cowork_coding_session"
    ) {
      input.recordSessionRelationshipHint(event.childSessionId, {
        kind: "cowork_child",
        parentSessionId: event.parentSessionId,
        sessionLinkId: event.sessionLinkId,
        relation: event.relation,
        workspaceId: input.workspaceId,
      });
      shouldInvalidateCowork = true;
    } else if (event.type === "session_link_turn_completed") {
      input.recordSessionRelationshipHint(event.childSessionId, {
        kind: "linked_child",
        parentSessionId: event.parentSessionId,
        sessionLinkId: event.sessionLinkId,
        relation: event.relation,
        workspaceId: input.workspaceId,
      });
    }
    if (event.type === "review_run_updated") {
      reviewParentSessionIds.add(event.parentSessionId);
    }
    if (event.type === "item_completed" && envelope.itemId) {
      const item = input.transcript.itemsById[envelope.itemId];
      if (item?.kind === "tool_call" && isSubagentMcpMutation(item)) {
        const launchResult = parseSubagentLaunchResult(item);
        const display = resolveSubagentLaunchDisplay(item);
        if (launchResult?.childSessionId) {
          input.recordSessionRelationshipHint(launchResult.childSessionId, {
            kind: "subagent_child",
            parentSessionId: input.sessionId,
            sessionLinkId: launchResult.sessionLinkId,
            relation: "subagent",
            workspaceId: input.workspaceId,
          });
          void input.mountSubagentChildSession({
            childSessionId: launchResult.childSessionId,
            label: display.title,
            workspaceId: input.workspaceId,
            parentSessionId: input.sessionId,
            sessionLinkId: launchResult.sessionLinkId,
            requestHeaders: input.requestHeaders,
          });
        }
        shouldInvalidateSessionSubagents = true;
      }
      if (
        item?.kind === "tool_call"
        && item.status === "completed"
        && isCoworkCodingCreateMcpMutation(item)
      ) {
        shouldInvalidateCowork = true;
        shouldInvalidateWorkspaceCollections = true;
      }
    }
  }

  for (const intent of input.reconciledIntents) {
    input.persistReconciledModePreferences(
      input.workspaceId,
      input.agentKind,
      intent.liveConfig.normalizedControls.mode?.rawConfigId ?? null,
      intent.reconciledChanges,
      (rawConfigId) => getAuthoritativeConfigValue(intent.liveConfig, rawConfigId),
    );
  }

  if (shouldInvalidateWorkspaceCollections) {
    void input.queryClient.invalidateQueries({
      queryKey: workspaceCollectionsScopeKey(input.runtimeUrl),
    });
  }
  if (lastActivityTimestamp && input.workspaceId) {
    trackWorkspaceInteraction(input.workspaceId, lastActivityTimestamp);
    input.acknowledgeWorkspaceActivity?.(input.workspaceId, lastActivityTimestamp);
  }
  if (shouldInvalidateSessionSubagents) {
    void input.queryClient.invalidateQueries({
      queryKey: anyHarnessSessionSubagentsKey(
        input.runtimeUrl,
        input.workspaceId,
        input.sessionId,
      ),
    });
  }
  if (shouldInvalidateCowork) {
    void input.queryClient.invalidateQueries({
      queryKey: anyHarnessCoworkManagedWorkspacesKey(
        input.runtimeUrl,
        input.sessionId,
      ),
    });
  }
  for (const parentSessionId of reviewParentSessionIds) {
    void input.queryClient.invalidateQueries({
      queryKey: anyHarnessSessionReviewsKey(
        input.runtimeUrl,
        input.workspaceId,
        parentSessionId,
      ),
    });
  }
  if (shouldInvalidateGitStatus && input.workspaceId) {
    void input.queryClient.invalidateQueries({
      queryKey: anyHarnessGitStatusKey(
        input.runtimeUrl,
        input.workspaceId,
      ),
    });
  }

  if (!hasQueuedPendingConfigChanges(input.pendingConfigChanges)) {
    appendOrderedEffect(orderedEffects, { kind: "clear_pending_config_rollback" });
  }
  for (const effect of orderedEffects) {
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
      case "schedule_pending_config_rollback":
        schedulePendingConfigRollbackCheck(
          input.sessionId,
          input.refreshSessionSlotMeta,
          input.showToast,
        );
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

function appendOrderedEffect(
  effects: OrderedStreamSideEffect[],
  effect: OrderedStreamSideEffect,
): void {
  const previous = effects[effects.length - 1];
  if (previous?.kind === effect.kind && effect.kind !== "notify_turn_end") {
    return;
  }
  effects.push(effect);
}

function isSubagentMcpMutation(item: ToolCallItem): boolean {
  const nativeToolName = item.nativeToolName?.trim().toLowerCase();
  return nativeToolName === "mcp__subagents__create_subagent"
    || nativeToolName === "mcp__subagents__send_subagent_message"
    || nativeToolName === "mcp__subagents__schedule_subagent_wake";
}

function isCoworkCodingCreateMcpMutation(item: ToolCallItem): boolean {
  const nativeToolName = item.nativeToolName?.trim().toLowerCase();
  return nativeToolName === "mcp__cowork__create_coding_workspace"
    || nativeToolName === "mcp__cowork__create_coding_session"
    || nativeToolName === "mcp__cowork__send_coding_message"
    || nativeToolName === "mcp__cowork__schedule_coding_wake";
}

function shouldScheduleActiveSummaryRefresh(eventType: string): boolean {
  switch (eventType) {
    case "turn_started":
    case "item_started":
    case "item_delta":
    case "item_completed":
    case "usage_update":
    case "interaction_resolved":
      return true;
    default:
      return false;
  }
}

function shouldTrackWorkspaceWorkActivity(eventType: string): boolean {
  switch (eventType) {
    case "turn_started":
    case "item_started":
    case "item_completed":
    case "interaction_requested":
    case "interaction_resolved":
    case "turn_ended":
    case "error":
    case "session_ended":
    case "subagent_turn_completed":
    case "session_link_turn_completed":
    case "review_run_updated":
      return true;
    default:
      return false;
  }
}
