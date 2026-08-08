import {
  createTranscriptState,
  type SessionEventEnvelope,
  type SessionLiveConfigSnapshot,
  type ToolCallItem,
  type TranscriptState,
} from "@anyharness/sdk";
import { describe, expect, it } from "vitest";
import type { PendingSessionConfigChanges } from "#product/domain/sessions/pending-config";
import { planBatchedStreamSideEffects } from "#product/lib/domain/sessions/stream/stream-side-effect-plan";

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
    expect(plan.invalidatePrStatus).toBe(true);
    expect(plan.lastActivityTimestamp).toBe("2026-04-04T00:00:03Z");
    expect(plan.orderedEffects).toEqual([
      { kind: "clear_active_summary_refresh" },
      { kind: "notify_turn_end", eventType: "turn_ended" },
      { kind: "clear_pending_config_rollback" },
      { kind: "schedule_active_summary_refresh" },
    ]);
  });

  it("plans invalidatePrStatus exactly when invalidateGitStatus is planned", () => {
    const turnEndPlan = planBatchedStreamSideEffects({
      ...baseInput(),
      envelopes: [turnEnded(2)],
    });
    expect(turnEndPlan.invalidatePrStatus).toBe(turnEndPlan.invalidateGitStatus);
    expect(turnEndPlan.invalidatePrStatus).toBe(true);

    const noTurnEndPlan = planBatchedStreamSideEffects({
      ...baseInput(),
      envelopes: [turnStarted(2)],
    });
    expect(noTurnEndPlan.invalidatePrStatus).toBe(noTurnEndPlan.invalidateGitStatus);
    expect(noTurnEndPlan.invalidatePrStatus).toBe(false);

    const noWorkspacePlan = planBatchedStreamSideEffects({
      ...baseInput(),
      workspaceId: null,
      envelopes: [turnEnded(2)],
    });
    expect(noWorkspacePlan.invalidatePrStatus).toBe(noWorkspacePlan.invalidateGitStatus);
    expect(noWorkspacePlan.invalidatePrStatus).toBe(false);
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

  it("invalidates subagent state for non-create MCP mutations without mounting", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById["tool-1"] = toolCallItem({
      itemId: "tool-1",
      nativeToolName: "mcp__subagents__schedule_subagent_wake",
      status: "completed",
      title: "schedule_subagent_wake",
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
    expect(plan.eventEffects).toEqual([]);
  });

  it("makes a spawned peer visible without putting it in the parent's fanout", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById["tool-1"] = toolCallItem({
      itemId: "tool-1",
      nativeToolName: "mcp__subagents__spawn_agent",
      status: "completed",
      title: "spawn_agent",
      rawInput: { label: "billing-webhooks" },
      rawOutput: {
        sessionId: "peer-session",
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
    expect(plan.invalidateWorkspaceCollections).toBe(true);
    // No relationship hint and no mount: an owned peer is nobody's subagent.
    expect(plan.eventEffects).toEqual([]);
  });

  it("refreshes workspace collections when an agent spawns a workspace", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById["tool-1"] = toolCallItem({
      itemId: "tool-1",
      nativeToolName: "mcp__subagents__spawn_workspace",
      status: "completed",
      title: "spawn_workspace",
      rawOutput: { workspaceId: "workspace-2" },
    });

    const plan = planBatchedStreamSideEffects({
      ...baseInput({ transcript }),
      envelopes: [
        itemCompleted(2, "tool-1"),
      ],
    });

    expect(plan.invalidateWorkspaceCollections).toBe(true);
    expect(plan.eventEffects).toEqual([]);
  });

  it("refetches the agents read model after a promotion", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById["tool-1"] = toolCallItem({
      itemId: "tool-1",
      nativeToolName: "mcp__subagents__promote_subagent",
      status: "completed",
      title: "promote_subagent",
      rawOutput: { childSessionId: "child-session", sessionLinkId: "link-1" },
    });

    const plan = planBatchedStreamSideEffects({
      ...baseInput({ transcript }),
      envelopes: [
        itemCompleted(2, "tool-1"),
      ],
    });

    expect(plan.invalidateSessionSubagents).toBe(true);
    expect(plan.eventEffects).toEqual([]);
  });

  it("bumps activity on turn boundary events only", () => {
    const plan = planBatchedStreamSideEffects({
      ...baseInput(),
      envelopes: [
        turnStarted(2),
        interactionRequested(3),
        turnEnded(4),
        errorEvent(5),
        sessionEnded(6),
      ],
    });

    expect(plan.lastActivityTimestamp).toBe("2026-04-04T00:00:06Z");
  });

  it("does not bump activity on mid-turn item ticks", () => {
    const plan = planBatchedStreamSideEffects({
      ...baseInput(),
      envelopes: [
        itemStarted(2),
        itemCompleted(3, "tool-1"),
      ],
    });

    expect(plan.lastActivityTimestamp).toBe(null);
  });

  it("does not bump activity on subagent mid-turn events", () => {
    const plan = planBatchedStreamSideEffects({
      ...baseInput(),
      envelopes: [
        subagentTurnCompleted(2),
      ],
    });

    expect(plan.lastActivityTimestamp).toBe(null);
  });

  it("does not bump activity on interaction_resolved (subsequent turn events handle it)", () => {
    const plan = planBatchedStreamSideEffects({
      ...baseInput(),
      envelopes: [
        interactionResolved(2),
      ],
    });

    expect(plan.lastActivityTimestamp).toBe(null);
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

    expect(plan.persistReconciledControlPreferences).toEqual([
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

function itemStarted(seq: number): SessionEventEnvelope {
  return envelope(seq, {
    type: "item_started",
    item: {
      kind: "tool_call",
      status: "in_progress",
      sourceAgentKind: "codex",
      contentParts: [],
    },
  } as unknown as SessionEventEnvelope["event"]);
}

function interactionRequested(seq: number): SessionEventEnvelope {
  return envelope(seq, {
    type: "interaction_requested",
    requestId: `interaction-${seq}`,
    kind: "permission",
    source: { tool_call_id: null },
  } as unknown as SessionEventEnvelope["event"]);
}

function interactionResolved(seq: number): SessionEventEnvelope {
  return envelope(seq, {
    type: "interaction_resolved",
    requestId: `interaction-${seq}`,
    kind: "permission",
    outcome: "allowed",
  } as unknown as SessionEventEnvelope["event"]);
}

function errorEvent(seq: number): SessionEventEnvelope {
  return envelope(seq, {
    type: "error",
    message: "test error",
  } as unknown as SessionEventEnvelope["event"]);
}

function sessionEnded(seq: number): SessionEventEnvelope {
  return envelope(seq, {
    type: "session_ended",
  } as unknown as SessionEventEnvelope["event"]);
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
