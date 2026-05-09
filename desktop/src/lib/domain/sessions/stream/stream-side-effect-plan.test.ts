import {
  createTranscriptState,
  type SessionEventEnvelope,
  type SessionLiveConfigSnapshot,
  type ToolCallItem,
  type TranscriptState,
} from "@anyharness/sdk";
import { describe, expect, it } from "vitest";
import type { PendingSessionConfigChanges } from "@/lib/domain/sessions/pending-config";
import { planBatchedStreamSideEffects } from "@/lib/domain/sessions/stream/stream-side-effect-plan";

describe("planBatchedStreamSideEffects", () => {
  it("plans ordered terminal and new-turn effects without executing them", () => {
    const plan = planBatchedStreamSideEffects({
      ...baseInput({
        pendingConfigChanges: queuedPendingConfigChanges(),
      }),
      envelopes: [
        turnEnded(2),
        turnStarted(3),
      ],
    });

    expect(plan.invalidateWorkspaceCollections).toBe(true);
    expect(plan.invalidateGitStatus).toBe(true);
    expect(plan.lastActivityTimestamp).toBe("2026-04-04T00:00:03Z");
    expect(plan.orderedEffects).toEqual([
      { kind: "clear_active_summary_refresh" },
      { kind: "schedule_pending_config_rollback" },
      { kind: "notify_turn_end", eventType: "turn_ended" },
      { kind: "clear_pending_config_rollback" },
      { kind: "schedule_active_summary_refresh" },
    ]);
  });

  it("plans final rollback clearing when no queued config changes remain", () => {
    const plan = planBatchedStreamSideEffects({
      ...baseInput(),
      envelopes: [],
    });

    expect(plan.orderedEffects).toEqual([
      { kind: "clear_pending_config_rollback" },
    ]);
  });

  it("plans startup refreshes from available command updates", () => {
    const plan = planBatchedStreamSideEffects({
      ...baseInput(),
      envelopes: [
        availableCommandsUpdate(2),
      ],
    });

    expect(plan.eventEffects).toEqual([
      {
        kind: "schedule_startup_ready_refresh",
        reason: "available_commands",
        delayMs: 0,
      },
    ]);
  });

  it("plans subagent relationship, mount, and cache invalidation commands", () => {
    const plan = planBatchedStreamSideEffects({
      ...baseInput(),
      envelopes: [
        subagentTurnCompleted(2),
      ],
    });

    expect(plan.invalidateSessionSubagents).toBe(true);
    expect(plan.eventEffects).toEqual([
      {
        kind: "record_session_relationship_hint",
        sessionId: "child-session",
        relationship: {
          kind: "subagent_child",
          parentSessionId: "session-1",
          sessionLinkId: "link-1",
          relation: "subagent",
          workspaceId: "workspace-1",
        },
      },
      {
        kind: "mount_subagent_child_session",
        childSessionId: "child-session",
        label: "Child",
        workspaceId: "workspace-1",
        parentSessionId: "session-1",
        sessionLinkId: "link-1",
      },
    ]);
  });

  it("plans cowork relationship and invalidation commands", () => {
    const plan = planBatchedStreamSideEffects({
      ...baseInput(),
      envelopes: [
        sessionLinkTurnCompleted(2, "cowork_coding_session"),
      ],
    });

    expect(plan.invalidateCowork).toBe(true);
    expect(plan.eventEffects).toEqual([
      {
        kind: "record_session_relationship_hint",
        sessionId: "child-session",
        relationship: {
          kind: "cowork_child",
          parentSessionId: "session-1",
          sessionLinkId: "link-1",
          relation: "cowork_coding_session",
          workspaceId: "workspace-1",
        },
      },
    ]);
  });

  it("dedupes review parent ids while preserving first-seen order", () => {
    const plan = planBatchedStreamSideEffects({
      ...baseInput(),
      envelopes: [
        reviewRunUpdated(2, "parent-1"),
        reviewRunUpdated(3, "parent-2"),
        reviewRunUpdated(4, "parent-1"),
      ],
    });

    expect(plan.reviewParentSessionIds).toEqual(["parent-1", "parent-2"]);
    expect(plan.lastActivityTimestamp).toBe("2026-04-04T00:00:04Z");
  });

  it("plans subagent effects from completed MCP tool calls", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById["tool-1"] = toolCallItem({
      itemId: "tool-1",
      nativeToolName: "mcp__subagents__create_subagent",
      status: "completed",
      title: "create_subagent",
      rawInput: {
        label: "repo-reviewer",
      },
      rawOutput: {
        childSessionId: "child-session",
        sessionLinkId: "link-1",
      },
    });

    const plan = planBatchedStreamSideEffects({
      ...baseInput({ transcript }),
      envelopes: [
        itemCompleted(2, "tool-1"),
      ],
    });

    expect(plan.invalidateSessionSubagents).toBe(true);
    expect(plan.eventEffects).toEqual([
      {
        kind: "record_session_relationship_hint",
        sessionId: "child-session",
        relationship: {
          kind: "subagent_child",
          parentSessionId: "session-1",
          sessionLinkId: "link-1",
          relation: "subagent",
          workspaceId: "workspace-1",
        },
      },
      {
        kind: "mount_subagent_child_session",
        childSessionId: "child-session",
        label: "repo-reviewer",
        workspaceId: "workspace-1",
        parentSessionId: "session-1",
        sessionLinkId: "link-1",
      },
    ]);
  });

  it("plans cowork invalidation from completed MCP tool calls", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById["tool-1"] = toolCallItem({
      itemId: "tool-1",
      nativeToolName: "mcp__cowork__create_coding_session",
      status: "completed",
    });

    const plan = planBatchedStreamSideEffects({
      ...baseInput({ transcript }),
      envelopes: [
        itemCompleted(2, "tool-1"),
      ],
    });

    expect(plan.invalidateCowork).toBe(true);
    expect(plan.invalidateWorkspaceCollections).toBe(true);
  });

  it("carries reconciled mode preference intents into the plan", () => {
    const liveConfig = liveConfigSnapshot();
    const reconciledChange = {
      rawConfigId: "mode",
      value: "plan",
      status: "queued" as const,
      mutationId: 1,
    };

    const plan = planBatchedStreamSideEffects({
      ...baseInput(),
      reconciledIntents: [
        {
          liveConfig,
          reconciledChanges: [reconciledChange],
        },
      ],
    });

    expect(plan.persistReconciledModePreferences).toEqual([
      {
        liveConfig,
        reconciledChanges: [reconciledChange],
      },
    ]);
  });
});

function baseInput(overrides?: {
  pendingConfigChanges?: PendingSessionConfigChanges;
  transcript?: TranscriptState;
}) {
  return {
    sessionId: "session-1",
    workspaceId: "workspace-1",
    envelopes: [] as SessionEventEnvelope[],
    transcript: overrides?.transcript ?? createTranscriptState("session-1"),
    pendingConfigChanges: overrides?.pendingConfigChanges ?? {},
    reconciledIntents: [],
  };
}

function queuedPendingConfigChanges(): PendingSessionConfigChanges {
  return {
    mode: {
      rawConfigId: "mode",
      value: "plan",
      status: "queued",
      mutationId: 1,
    },
  };
}

function availableCommandsUpdate(seq: number): SessionEventEnvelope {
  return envelope(seq, {
    type: "available_commands_update",
    availableCommands: [],
  });
}

function turnStarted(seq: number): SessionEventEnvelope {
  return envelope(seq, { type: "turn_started" });
}

function turnEnded(seq: number): SessionEventEnvelope {
  return envelope(seq, {
    type: "turn_ended",
    stopReason: "end_turn",
  });
}

function subagentTurnCompleted(seq: number): SessionEventEnvelope {
  return envelope(seq, {
    type: "subagent_turn_completed",
    childSessionId: "child-session",
    parentSessionId: "session-1",
    sessionLinkId: "link-1",
    childTurnId: "child-turn-1",
    childLastEventSeq: 10,
    completionId: "completion-1",
    outcome: "completed",
    label: "Child",
  });
}

function sessionLinkTurnCompleted(seq: number, relation: string): SessionEventEnvelope {
  return envelope(seq, {
    type: "session_link_turn_completed",
    childSessionId: "child-session",
    parentSessionId: "session-1",
    sessionLinkId: "link-1",
    childTurnId: "child-turn-1",
    childLastEventSeq: 10,
    completionId: "completion-1",
    outcome: "completed",
    relation,
  });
}

function reviewRunUpdated(seq: number, parentSessionId: string): SessionEventEnvelope {
  return envelope(seq, {
    type: "review_run_updated",
    parentSessionId,
    reviewRunId: `review-${seq}`,
    kind: "code",
    status: "reviewing",
    autoIterate: false,
    currentRoundNumber: 1,
    maxRounds: 1,
    activeRoundId: null,
    updatedAt: `2026-04-04T00:00:0${seq}Z`,
  });
}

function itemCompleted(seq: number, itemId: string): SessionEventEnvelope {
  return {
    ...envelope(seq, {
      type: "item_completed",
      item: {
        kind: "tool_call",
        status: "completed",
        sourceAgentKind: "codex",
        contentParts: [],
      },
    } as unknown as SessionEventEnvelope["event"]),
    itemId,
  };
}

function envelope(seq: number, event: SessionEventEnvelope["event"]): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq,
    timestamp: `2026-04-04T00:00:0${seq}Z`,
    turnId: "turn-1",
    event,
  };
}

function toolCallItem(overrides: Partial<ToolCallItem>): ToolCallItem {
  return {
    kind: "tool_call",
    itemId: "tool-1",
    turnId: "turn-1",
    status: "in_progress",
    sourceAgentKind: "codex",
    messageId: null,
    title: null,
    nativeToolName: "Agent",
    parentToolCallId: null,
    rawInput: undefined,
    rawOutput: undefined,
    contentParts: [],
    timestamp: "2026-04-04T00:00:00Z",
    startedSeq: 1,
    lastUpdatedSeq: 1,
    completedSeq: null,
    completedAt: null,
    toolCallId: "toolu_1",
    toolKind: "think",
    semanticKind: "subagent",
    approvalState: "none",
    ...overrides,
  };
}

function liveConfigSnapshot(): SessionLiveConfigSnapshot {
  return {
    rawConfigOptions: [
      {
        id: "mode",
        name: "Mode",
        type: "select",
        currentValue: "plan",
        options: [
          { value: "plan", name: "Plan" },
        ],
      },
    ],
    normalizedControls: {
      model: null,
      collaborationMode: null,
      mode: {
        key: "mode",
        rawConfigId: "mode",
        label: "Mode",
        currentValue: "plan",
        settable: true,
        values: [
          { value: "plan", label: "Plan" },
        ],
      },
      reasoning: null,
      effort: null,
      fastMode: null,
      extras: [],
    },
    sourceSeq: 1,
    updatedAt: "2026-04-04T00:00:00Z",
  };
}
