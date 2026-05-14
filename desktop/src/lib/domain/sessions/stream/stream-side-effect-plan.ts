import type {
  SessionEventEnvelope,
  SessionLiveConfigSnapshot,
  ToolCallItem,
  TranscriptState,
} from "@anyharness/sdk";
import type {
  PendingSessionConfigChange,
  PendingSessionConfigChanges,
} from "@/lib/domain/sessions/pending-config";
import {
  parseSubagentLaunchResult,
  resolveSubagentLaunchDisplay,
} from "@/lib/domain/chat/subagents/subagent-launch";

export interface ReconciledStreamConfigIntent {
  liveConfig: SessionLiveConfigSnapshot;
  reconciledChanges: PendingSessionConfigChange[];
}

export type PlannedSessionChildRelationship =
  | {
    kind: "subagent_child";
    parentSessionId: string | null;
    sessionLinkId?: string | null;
    relation?: string | null;
    workspaceId?: string | null;
  }
  | {
    kind: "cowork_child";
    parentSessionId: string | null;
    sessionLinkId?: string | null;
    relation?: string | null;
    workspaceId?: string | null;
  }
  | {
    kind: "linked_child";
    parentSessionId: string | null;
    sessionLinkId?: string | null;
    relation?: string | null;
    workspaceId?: string | null;
  };

export type PlannedStreamEventEffect =
  | {
    kind: "schedule_startup_ready_refresh";
    reason: "available_commands";
    delayMs: number;
  }
  | {
    kind: "record_session_relationship_hint";
    sessionId: string;
    relationship: PlannedSessionChildRelationship;
  }
  | {
    kind: "mount_subagent_child_session";
    childSessionId: string;
    label: string | null;
    workspaceId: string | null;
    parentSessionId: string | null;
    sessionLinkId?: string | null;
  };

export type OrderedStreamSideEffect =
  | { kind: "clear_pending_config_rollback" }
  | { kind: "schedule_active_summary_refresh" }
  | { kind: "clear_active_summary_refresh" }
  | {
    kind: "notify_turn_end";
    eventType: "turn_ended" | "error";
  };

export interface BatchedStreamSideEffectPlan {
  eventEffects: PlannedStreamEventEffect[];
  persistReconciledModePreferences: ReconciledStreamConfigIntent[];
  invalidateWorkspaceCollections: boolean;
  invalidateGitStatus: boolean;
  lastActivityTimestamp: string | null;
  invalidateSessionSubagents: boolean;
  invalidateCowork: boolean;
  reviewParentSessionIds: string[];
  orderedEffects: OrderedStreamSideEffect[];
}

export function planBatchedStreamSideEffects(input: {
  sessionId: string;
  workspaceId: string | null;
  envelopes: SessionEventEnvelope[];
  transcript: TranscriptState;
  pendingConfigChanges: PendingSessionConfigChanges;
  reconciledIntents: ReconciledStreamConfigIntent[];
}): BatchedStreamSideEffectPlan {
  let invalidateWorkspaceCollections = false;
  let invalidateGitStatus = false;
  let lastActivityTimestamp: string | null = null;
  let invalidateSessionSubagents = false;
  let invalidateCowork = false;
  const reviewParentSessionIds = new Set<string>();
  const eventEffects: PlannedStreamEventEffect[] = [];
  const orderedEffects: OrderedStreamSideEffect[] = [];

  for (const envelope of input.envelopes) {
    const event = envelope.event;
    if (event.type === "available_commands_update") {
      eventEffects.push({
        kind: "schedule_startup_ready_refresh",
        reason: "available_commands",
        delayMs: 0,
      });
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
      invalidateWorkspaceCollections = true;
    }
    if (input.workspaceId && shouldTrackWorkspaceWorkActivity(event.type)) {
      lastActivityTimestamp = envelope.timestamp;
    }
    if (event.type === "turn_ended" || event.type === "error") {
      invalidateGitStatus = !!input.workspaceId;
      orderedEffects.push({
        kind: "notify_turn_end",
        eventType: event.type,
      });
    }
    if (event.type === "subagent_turn_completed") {
      eventEffects.push({
        kind: "record_session_relationship_hint",
        sessionId: event.childSessionId,
        relationship: {
          kind: "subagent_child",
          parentSessionId: event.parentSessionId,
          sessionLinkId: event.sessionLinkId,
          relation: "subagent",
          workspaceId: input.workspaceId,
        },
      });
      eventEffects.push({
        kind: "mount_subagent_child_session",
        childSessionId: event.childSessionId,
        label: event.label ?? null,
        workspaceId: input.workspaceId,
        parentSessionId: event.parentSessionId,
        sessionLinkId: event.sessionLinkId,
      });
      invalidateSessionSubagents = true;
    }
    if (
      event.type === "session_link_turn_completed"
      && event.relation === "cowork_coding_session"
    ) {
      eventEffects.push({
        kind: "record_session_relationship_hint",
        sessionId: event.childSessionId,
        relationship: {
          kind: "cowork_child",
          parentSessionId: event.parentSessionId,
          sessionLinkId: event.sessionLinkId,
          relation: event.relation,
          workspaceId: input.workspaceId,
        },
      });
      invalidateCowork = true;
    } else if (event.type === "session_link_turn_completed") {
      eventEffects.push({
        kind: "record_session_relationship_hint",
        sessionId: event.childSessionId,
        relationship: {
          kind: "linked_child",
          parentSessionId: event.parentSessionId,
          sessionLinkId: event.sessionLinkId,
          relation: event.relation,
          workspaceId: input.workspaceId,
        },
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
          eventEffects.push({
            kind: "record_session_relationship_hint",
            sessionId: launchResult.childSessionId,
            relationship: {
              kind: "subagent_child",
              parentSessionId: input.sessionId,
              sessionLinkId: launchResult.sessionLinkId,
              relation: "subagent",
              workspaceId: input.workspaceId,
            },
          });
          eventEffects.push({
            kind: "mount_subagent_child_session",
            childSessionId: launchResult.childSessionId,
            label: display.title,
            workspaceId: input.workspaceId,
            parentSessionId: input.sessionId,
            sessionLinkId: launchResult.sessionLinkId,
          });
        }
        invalidateSessionSubagents = true;
      }
      if (
        item?.kind === "tool_call"
        && item.status === "completed"
        && isCoworkCodingCreateMcpMutation(item)
      ) {
        invalidateCowork = true;
        invalidateWorkspaceCollections = true;
      }
    }
  }

  appendFinalPendingConfigRollbackClear(orderedEffects);

  return {
    eventEffects,
    persistReconciledModePreferences: input.reconciledIntents,
    invalidateWorkspaceCollections,
    invalidateGitStatus,
    lastActivityTimestamp,
    invalidateSessionSubagents,
    invalidateCowork,
    reviewParentSessionIds: [...reviewParentSessionIds],
    orderedEffects,
  };
}

function appendFinalPendingConfigRollbackClear(
  effects: OrderedStreamSideEffect[],
): void {
  if (effects.some((effect) => effect.kind === "clear_pending_config_rollback")) {
    return;
  }
  effects.push({ kind: "clear_pending_config_rollback" });
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
  return nativeToolName === "mcp__subagents__create_subagent";
}

function isCoworkCodingCreateMcpMutation(item: ToolCallItem): boolean {
  const nativeToolName = item.nativeToolName?.trim().toLowerCase();
  return nativeToolName === "mcp__cowork__create_cowork_workspace"
    || nativeToolName === "mcp__cowork__create_coding_workspace"
    || nativeToolName === "mcp__cowork__create_cowork_agent"
    || nativeToolName === "mcp__cowork__create_coding_session"
    || nativeToolName === "mcp__cowork__send_cowork_agent_message"
    || nativeToolName === "mcp__cowork__send_coding_message"
    || nativeToolName === "mcp__cowork__schedule_cowork_agent_wake"
    || nativeToolName === "mcp__cowork__schedule_coding_wake"
    || nativeToolName === "mcp__cowork__close_cowork_agent";
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
