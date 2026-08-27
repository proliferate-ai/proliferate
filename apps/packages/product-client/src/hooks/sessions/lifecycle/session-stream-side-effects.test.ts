import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  createTranscriptState,
  type SessionEventEnvelope,
  type SessionLiveConfigSnapshot,
  type ToolCallItem,
} from "@anyharness/sdk";
import {
  applyBatchedStreamSideEffects,
  resetStreamWorkspaceActivityForTests,
} from "#product/hooks/sessions/lifecycle/session-stream-side-effects";
import type { SessionStreamCache } from "#product/hooks/sessions/cache/use-session-stream-cache";
import type { PendingSessionConfigChanges } from "#product/domain/sessions/pending-config";
import type { SessionRelationship } from "#product/lib/domain/sessions/directory/relationship";

const mocks = vi.hoisted(() => ({
  effectOrder: [] as string[],
  trackWorkspaceInteraction: vi.fn(),
  trackSessionInteraction: vi.fn(),
  notifyTurnEnd: vi.fn(),
  notifyUserFacingTurnEnd: vi.fn(),
  clearPendingConfigRollbackCheck: vi.fn(),
  relaySeatLimitHit: vi.fn(),
}));

vi.mock("#product/lib/access/cloud/seat-limit-report", () => ({
  relaySeatLimitHit: mocks.relaySeatLimitHit,
}));

vi.mock("#product/stores/preferences/workspace-ui-store", () => ({
  trackSessionInteraction: mocks.trackSessionInteraction,
  trackWorkspaceInteraction: mocks.trackWorkspaceInteraction,
}));

vi.mock("#product/lib/infra/events/turn-end-events", () => ({
  notifyTurnEnd: mocks.notifyTurnEnd,
  notifyUserFacingTurnEnd: mocks.notifyUserFacingTurnEnd,
}));

vi.mock("#product/hooks/sessions/lifecycle/session-runtime-pending-config", () => ({
  clearPendingConfigRollbackCheck: mocks.clearPendingConfigRollbackCheck,
}));

describe("applyBatchedStreamSideEffects", () => {
  beforeEach(() => {
    resetStreamWorkspaceActivityForTests();
    mocks.effectOrder.length = 0;
    vi.clearAllMocks();
    mocks.trackWorkspaceInteraction.mockImplementation((workspaceId: string, timestamp: string) => {
      mocks.effectOrder.push(`activity:${workspaceId}:${timestamp}`);
    });
    mocks.trackSessionInteraction.mockImplementation((sessionId: string, timestamp: string) => {
      mocks.effectOrder.push(`session-activity:${sessionId}:${timestamp}`);
    });
    mocks.notifyTurnEnd.mockImplementation((sessionId: string, eventType: string) => {
      mocks.effectOrder.push(`notify:${sessionId}:${eventType}`);
    });
    mocks.notifyUserFacingTurnEnd.mockImplementation((sessionId: string, eventType: string) => {
      mocks.effectOrder.push(`notify-user:${sessionId}:${eventType}`);
    });
    mocks.clearPendingConfigRollbackCheck.mockImplementation((sessionId: string) => {
      mocks.effectOrder.push(`clear-rollback:${sessionId}`);
    });
  });

  it("preserves ordered timer side effects across terminal and new-turn events", () => {
    applyBatchedStreamSideEffects({
      ...baseInput({
        pendingConfigChanges: queuedPendingConfigChanges(),
      }),
      envelopes: [
        turnEnded(2),
        turnStarted(3),
      ],
      clearActiveSummaryRefreshTimer: () => {
        mocks.effectOrder.push("clear-summary");
      },
      scheduleActiveSummaryRefresh: () => {
        mocks.effectOrder.push("schedule-summary");
      },
    });

    expect(mocks.effectOrder).toEqual([
      "activity:workspace-1:2026-04-04T00:00:03Z",
      "session-activity:session-1:2026-04-04T00:00:03Z",
      "clear-summary",
      "notify:session-1:turn_ended",
      "clear-rollback:session-1",
      "schedule-summary",
    ]);
  });

  it("tracks activity at the last work event timestamp, not the last envelope timestamp", () => {
    applyBatchedStreamSideEffects({
      ...baseInput(),
      envelopes: [
        turnStarted(2),
        usageUpdate(3),
      ],
    });

    expect(mocks.trackWorkspaceInteraction).toHaveBeenCalledWith(
      "workspace-1",
      "2026-04-04T00:00:02Z",
    );
    expect(mocks.trackSessionInteraction).toHaveBeenCalledWith(
      "session-1",
      "2026-04-04T00:00:02Z",
    );
  });

  it("delegates stream cache invalidations to the session cache helper", () => {
    const sessionStreamCache = createTestSessionStreamCache();

    applyBatchedStreamSideEffects({
      ...baseInput(),
      sessionStreamCache,
      envelopes: [
        turnEnded(2),
      ],
    });

    expect(sessionStreamCache.invalidateWorkspaceCollections)
      .toHaveBeenCalledWith("http://runtime.test");
    expect(sessionStreamCache.invalidateGitStatus).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
    });
  });

  it("acknowledges selected activity in the same side-effect pass", () => {
    const acknowledgeWorkspaceActivity = vi.fn((workspaceId: string, timestamp: string) => {
      mocks.effectOrder.push(`ack:${workspaceId}:${timestamp}`);
    });

    applyBatchedStreamSideEffects({
      ...baseInput(),
      acknowledgeWorkspaceActivity,
      envelopes: [
        turnStarted(2),
      ],
    });

    expect(mocks.effectOrder).toEqual([
      "activity:workspace-1:2026-04-04T00:00:02Z",
      "ack:workspace-1:2026-04-04T00:00:02Z",
      "session-activity:session-1:2026-04-04T00:00:02Z",
      "clear-rollback:session-1",
    ]);
  });

  it("forwards stream-reconciled controls to launch-default persistence", () => {
    const input = baseInput();
    const liveConfig = effortLiveConfigSnapshot();
    const reconciledChange = {
      rawConfigId: "reasoning_effort",
      value: "xhigh",
      status: "queued" as const,
      mutationId: 1,
    };

    applyBatchedStreamSideEffects({
      ...input,
      reconciledIntents: [{
        liveConfig,
        reconciledChanges: [reconciledChange],
      }],
    });

    expect(input.persistReconciledControlPreferences).toHaveBeenCalledWith(
      "workspace-1",
      "codex",
      liveConfig,
      [reconciledChange],
    );
  });

  it("notifies once for every terminal event in a batch", () => {
    applyBatchedStreamSideEffects({
      ...baseInput(),
      envelopes: [
        turnEnded(2),
        errorEvent(3),
      ],
    });

    expect(mocks.notifyTurnEnd).toHaveBeenCalledTimes(2);
    expect(mocks.notifyTurnEnd).toHaveBeenNthCalledWith(1, "session-1", "turn_ended");
    expect(mocks.notifyTurnEnd).toHaveBeenNthCalledWith(2, "session-1", "error");
    expect(mocks.notifyUserFacingTurnEnd).not.toHaveBeenCalled();
  });

  it("relays a seat_usage_limit error through the courier report, plain errors not", () => {
    applyBatchedStreamSideEffects({
      ...baseInput(),
      envelopes: [
        errorEvent(2),
        seatLimitErrorEvent(3),
      ],
    });

    expect(mocks.relaySeatLimitHit).toHaveBeenCalledTimes(1);
    expect(mocks.relaySeatLimitHit).toHaveBeenCalledWith({
      sessionId: "session-1",
      seq: 3,
      seatId: "seat-1",
      window: "five_hour",
      resetAt: "2026-08-27T18:00:00Z",
    });
  });

  it("emits user-facing completion only for explicitly root sessions", () => {
    applyBatchedStreamSideEffects({
      ...baseInput({
        sessionRelationship: { kind: "root" },
      }),
      envelopes: [
        turnEnded(2),
        errorEvent(3),
      ],
    });

    expect(mocks.notifyTurnEnd).toHaveBeenCalledTimes(2);
    expect(mocks.notifyUserFacingTurnEnd).toHaveBeenCalledTimes(2);
    expect(mocks.notifyUserFacingTurnEnd).toHaveBeenNthCalledWith(1, "session-1", "turn_ended");
    expect(mocks.notifyUserFacingTurnEnd).toHaveBeenNthCalledWith(2, "session-1", "error");
  });

  it("marks durable and mapped client aliases before invalidating promotion rosters", () => {
    const input = baseInput();
    const transcript = createTranscriptState("session-1");
    transcript.itemsById["tool-1"] = workspacePromotionToolCall();
    input.resolveClientSessionId.mockReturnValue("client-session");
    const invalidateSessionSubagents = vi.mocked(
      input.sessionStreamCache.invalidateSessionSubagents,
    );

    applyBatchedStreamSideEffects({
      ...input,
      transcript,
      envelopes: [itemCompleted(2, "tool-1")],
    });

    expect(input.resolveClientSessionId).toHaveBeenCalledWith("durable-session");
    expect(input.markSessionPromoted).toHaveBeenCalledWith(
      ["durable-session", "client-session"],
      "workspace-1",
    );
    expect(invalidateSessionSubagents).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      sessionId: "durable-session-1",
    });
    expect(input.markSessionPromoted.mock.invocationCallOrder[0]).toBeLessThan(
      invalidateSessionSubagents.mock.invocationCallOrder[0]!,
    );
  });

  it("records and mounts a created child through its existing client alias", () => {
    const input = baseInput();
    const transcript = createTranscriptState("session-1");
    transcript.itemsById["tool-create"] = workspaceCreateToolCall();
    input.resolveClientSessionId.mockImplementation((sessionId: string) =>
      sessionId === "durable-created" ? "client-created" : null
    );

    applyBatchedStreamSideEffects({
      ...input,
      transcript,
      envelopes: [itemCompleted(2, "tool-create")],
    });

    expect(input.recordSessionRelationshipHint).toHaveBeenCalledWith(
      "client-created",
      expect.objectContaining({
        kind: "subagent_child",
        parentSessionId: "durable-session-1",
      }),
    );
    expect(input.mountSubagentChildSession).toHaveBeenCalledWith(
      expect.objectContaining({ childSessionId: "client-created" }),
    );
    expect(input.mountSubagentChildSession).not.toHaveBeenCalledWith(
      expect.objectContaining({ childSessionId: "durable-created" }),
    );
  });
});

function baseInput(overrides?: {
  pendingConfigChanges?: PendingSessionConfigChanges;
  sessionRelationship?: SessionRelationship | null;
}) {
  const sessionRelationship: SessionRelationship | null =
    overrides?.sessionRelationship ?? { kind: "pending" };
  return {
    sessionStreamCache: createTestSessionStreamCache(),
    sessionId: "session-1",
    materializedSessionId: "durable-session-1",
    runtimeUrl: "http://runtime.test",
    workspaceId: "workspace-1",
    agentKind: "codex",
    envelopes: [] as SessionEventEnvelope[],
    transcript: createTranscriptState("session-1"),
    pendingConfigChanges: overrides?.pendingConfigChanges ?? {},
    reconciledIntents: [],
    mountSubagentChildSession: vi.fn(),
    recordSessionRelationshipHint: vi.fn(),
    resolveClientSessionId: vi.fn((_sessionId: string): string | null => null),
    markSessionPromoted: vi.fn(),
    getSessionRelationship: vi.fn((sessionId: string) =>
      sessionId === "session-1" ? sessionRelationship : null),
    persistReconciledControlPreferences: vi.fn(),
    refreshSessionSlotMeta: vi.fn(),
    showToast: vi.fn(),
    clearActiveSummaryRefreshTimer: vi.fn(),
    scheduleActiveSummaryRefresh: vi.fn(),
    scheduleStartupReadyRefresh: vi.fn(),
  };
}

function workspacePromotionToolCall(): ToolCallItem {
  return {
    kind: "tool_call",
    itemId: "tool-1",
    turnId: "turn-1",
    status: "completed",
    sourceAgentKind: "codex",
    messageId: null,
    title: "Promote subagent",
    nativeToolName: "mcp__proliferate_workspace__promote_subagent",
    parentToolCallId: null,
    rawInput: { agentId: "durable-session" },
    rawOutput: {
      identity: { runtimeId: "runtime-1", sessionId: "durable-session" },
      workspace: { runtimeId: "runtime-1", workspaceId: "workspace-1" },
      role: "ordinary",
      parent: null,
      configuration: { agentKind: "codex", modelId: null, modeId: null },
      status: { presentation: "available", execution: "idle", hasLiveActor: true },
      capabilities: ["get_agent", "send_message"],
      createdAt: "2026-04-04T00:00:00Z",
      updatedAt: "2026-04-04T00:00:01Z",
    },
    contentParts: [],
    timestamp: "2026-04-04T00:00:01Z",
    startedSeq: 1,
    lastUpdatedSeq: 2,
    completedSeq: 2,
    completedAt: "2026-04-04T00:00:02Z",
    toolCallId: "tool-1",
    toolKind: "other",
    semanticKind: "other",
    approvalState: "none",
  };
}

function workspaceCreateToolCall(): ToolCallItem {
  const item = workspacePromotionToolCall();
  const rawOutput = item.rawOutput as Record<string, unknown>;
  return {
    ...item,
    itemId: "tool-create",
    title: "Create subagent",
    nativeToolName: "mcp__proliferate_workspace__create_agent",
    rawInput: {
      kind: "subagent",
      task: "Inspect schemas",
      workspaceId: "workspace-1",
    },
    rawOutput: {
      ...rawOutput,
      identity: { runtimeId: "runtime-1", sessionId: "durable-created" },
      parent: { runtimeId: "runtime-1", sessionId: "durable-session-1" },
      role: "subagent",
      title: "Schema agent",
    },
    toolCallId: "tool-create",
  };
}

function itemCompleted(seq: number, itemId: string): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq,
    timestamp: `2026-04-04T00:00:0${seq}Z`,
    turnId: "turn-1",
    itemId,
    event: {
      type: "item_completed",
      item: itemId === "tool-create"
        ? workspaceCreateToolCall()
        : workspacePromotionToolCall(),
    },
  } as SessionEventEnvelope;
}

function createTestSessionStreamCache(): SessionStreamCache {
  return {
    invalidateWorkspaceCollections: vi.fn(),
    invalidateSessionSubagents: vi.fn(),
    invalidateCoworkManagedWorkspaces: vi.fn(),
    invalidateSessionReviews: vi.fn(),
    invalidateGitStatus: vi.fn(),
    refreshPrStatuses: vi.fn(),
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

function effortLiveConfigSnapshot(): SessionLiveConfigSnapshot {
  return {
    rawConfigOptions: [],
    normalizedControls: {
      model: null,
      collaborationMode: null,
      mode: null,
      reasoning: null,
      effort: {
        key: "effort",
        rawConfigId: "reasoning_effort",
        label: "Effort",
        currentValue: "xhigh",
        settable: true,
        values: [{ value: "xhigh", label: "Extra High" }],
      },
      fastMode: null,
      extras: [],
    },
    sourceSeq: 2,
    updatedAt: "2026-04-04T00:00:02Z",
  };
}

function turnStarted(seq: number): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq,
    timestamp: `2026-04-04T00:00:0${seq}Z`,
    turnId: "turn-1",
    event: { type: "turn_started" },
  };
}

function turnEnded(seq: number): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq,
    timestamp: `2026-04-04T00:00:0${seq}Z`,
    turnId: "turn-1",
    event: { type: "turn_ended", stopReason: "end_turn" },
  };
}

function errorEvent(seq: number): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq,
    timestamp: `2026-04-04T00:00:0${seq}Z`,
    turnId: "turn-1",
    event: {
      type: "error",
      message: "failed",
    },
  };
}

function seatLimitErrorEvent(seq: number): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq,
    timestamp: `2026-04-04T00:00:0${seq}Z`,
    turnId: "turn-1",
    event: {
      type: "error",
      message: "seat usage limit reached",
      code: "seat_usage_limit",
      details: {
        kind: "seat_usage_limit",
        seatId: "seat-1",
        window: "five_hour",
        resetAt: "2026-08-27T18:00:00Z",
      },
    } as unknown as SessionEventEnvelope["event"],
  };
}

function usageUpdate(seq: number): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq,
    timestamp: `2026-04-04T00:00:0${seq}Z`,
    event: {
      type: "usage_update",
    },
  } as SessionEventEnvelope;
}
