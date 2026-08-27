import type {
  SessionEventEnvelope,
  SessionLiveConfigSnapshot,
  ToolCallItem,
  TranscriptState,
} from "@anyharness/sdk";
import type {
  PendingSessionConfigChange,
  PendingSessionConfigChanges,
} from "#product/domain/sessions/pending-config";
import {
  resolveAgentOperationsTool,
} from "#product/domain/chats/tools/agent-operations-tool-presentation";
import {
  deriveAuthoritativeAgentOperation,
} from "#product/lib/domain/sessions/agent-operations-authority";
import {
  readSeatUsageLimitDetails,
} from "#product/domain/chats/transcript/seat-usage-limit";

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
  }
  | {
    kind: "mark_session_promoted";
    durableSessionId: string;
    workspaceId: string | null;
  }
  | {
    /**
     * A `seat_usage_limit` turn error arrived: relay the observed hit to the
     * cloud (agent_auth §4 cell 3, `reportSeatLimitHit`). Identity is the
     * envelope's (runtime session id, seq) — the relay dedupes on it.
     */
    kind: "report_seat_limit_hit";
    sessionId: string;
    seq: number;
    seatId: string;
    window: "five_hour" | "seven_day" | null;
    resetAt: string;
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
  /**
   * True when the batch carried an `available_commands_update`, so the
   * applier records the session's post-batch command catalog for reuse by
   * surfaces without a live session (the home composer, PRO-228).
   */
  recordAvailableCommandsCatalog: boolean;
  persistReconciledControlPreferences: ReconciledStreamConfigIntent[];
  invalidateWorkspaceCollections: boolean;
  invalidateGitStatus: boolean;
  invalidatePrStatus: boolean;
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
  let invalidatePrStatus = false;
  let lastActivityTimestamp: string | null = null;
  let invalidateSessionSubagents = false;
  let invalidateCowork = false;
  let recordAvailableCommandsCatalog = false;
  const reviewParentSessionIds = new Set<string>();
  const eventEffects: PlannedStreamEventEffect[] = [];
  const orderedEffects: OrderedStreamSideEffect[] = [];

  for (const envelope of input.envelopes) {
    const event = envelope.event;
    if (event.type === "available_commands_update") {
      recordAvailableCommandsCatalog = true;
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
    if (shouldTrackWorkspaceWorkActivity(event.type)) {
      lastActivityTimestamp = envelope.timestamp;
    }
    if (event.type === "turn_ended" || event.type === "error") {
      invalidateGitStatus = !!input.workspaceId;
      invalidatePrStatus = invalidateGitStatus;
      orderedEffects.push({
        kind: "notify_turn_end",
        eventType: event.type,
      });
    }
    if (event.type === "error") {
      const seatLimit = readSeatUsageLimitDetails(event.details);
      if (seatLimit) {
        eventEffects.push({
          kind: "report_seat_limit_hit",
          sessionId: envelope.sessionId,
          seq: envelope.seq,
          seatId: seatLimit.seatId,
          window: seatLimit.window,
          resetAt: seatLimit.resetAt,
        });
      }
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
      const agentOperation = item?.kind === "tool_call" && item.status === "completed"
        ? deriveAuthoritativeAgentOperation(item, input.sessionId, input.workspaceId)
        : null;
      const agentOperationClassification = item?.kind === "tool_call"
        && item.status === "completed"
        ? resolveAgentOperationsTool(item)
        : null;
      if (
        agentOperationClassification?.action === "create_agent"
        || agentOperationClassification?.action === "promote_subagent"
      ) {
        // Even a completed result whose AgentView is malformed cannot grant
        // local authority, but the server roster may still have converged.
        invalidateSessionSubagents = true;
      }
      if (
        agentOperation?.action === "create_agent"
        && agentOperation.agent?.role === "subagent"
        && agentOperation.agent.sessionId
      ) {
        const childSessionId = agentOperation.agent.sessionId;
        const workspaceId = agentOperation.agent.workspaceId ?? input.workspaceId;
        const parentSessionId = agentOperation.agent.parentSessionId ?? input.sessionId;
        eventEffects.push({
          kind: "record_session_relationship_hint",
          sessionId: childSessionId,
          relationship: {
            kind: "subagent_child",
            parentSessionId,
            relation: "subagent",
            workspaceId,
          },
        });
        eventEffects.push({
          kind: "mount_subagent_child_session",
          childSessionId,
          label: agentOperation.agent.title,
          workspaceId,
          parentSessionId,
        });
      }
      if (
        agentOperation?.action === "promote_subagent"
        && agentOperation.agent?.role === "ordinary"
        && agentOperation.agent.sessionId
      ) {
        eventEffects.push({
          kind: "mark_session_promoted",
          durableSessionId: agentOperation.agent.sessionId,
          workspaceId: agentOperation.agent.workspaceId ?? input.workspaceId,
        });
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
    recordAvailableCommandsCatalog,
    persistReconciledControlPreferences: input.reconciledIntents,
    invalidateWorkspaceCollections,
    invalidateGitStatus,
    invalidatePrStatus,
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

/**
 * Gates the sidebar recency sort and displayed relative date. Only turn
 * boundaries count — never mid-turn item ticks — so concurrent runs don't
 * leapfrog each other in the sidebar while agents are working.
 */
function shouldTrackWorkspaceWorkActivity(eventType: string): boolean {
  switch (eventType) {
    case "turn_started":
    case "turn_ended":
    case "error":
    case "session_ended":
    case "interaction_requested":
      return true;
    default:
      return false;
  }
}
