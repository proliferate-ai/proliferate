import { QueryClient } from "@tanstack/react-query";
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
} from "@anyharness/sdk";
import { applyBatchedStreamSideEffects } from "@/hooks/sessions/session-stream-side-effects";
import type { PendingSessionConfigChanges } from "@/lib/domain/sessions/pending-config";
import type { SessionRelationship } from "@/stores/sessions/harness-store";

const mocks = vi.hoisted(() => ({
  effectOrder: [] as string[],
  trackWorkspaceInteraction: vi.fn(),
  notifyTurnEnd: vi.fn(),
  notifyUserFacingTurnEnd: vi.fn(),
  clearPendingConfigRollbackCheck: vi.fn(),
  schedulePendingConfigRollbackCheck: vi.fn(),
}));

vi.mock("@/stores/preferences/workspace-ui-store", () => ({
  trackWorkspaceInteraction: mocks.trackWorkspaceInteraction,
}));

vi.mock("@/lib/integrations/anyharness/turn-end-events", () => ({
  notifyTurnEnd: mocks.notifyTurnEnd,
  notifyUserFacingTurnEnd: mocks.notifyUserFacingTurnEnd,
}));

vi.mock("@/hooks/sessions/session-runtime-pending-config", () => ({
  clearPendingConfigRollbackCheck: mocks.clearPendingConfigRollbackCheck,
  schedulePendingConfigRollbackCheck: mocks.schedulePendingConfigRollbackCheck,
}));

describe("applyBatchedStreamSideEffects", () => {
  beforeEach(() => {
    mocks.effectOrder.length = 0;
    vi.clearAllMocks();
    mocks.trackWorkspaceInteraction.mockImplementation((workspaceId: string, timestamp: string) => {
      mocks.effectOrder.push(`activity:${workspaceId}:${timestamp}`);
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
    mocks.schedulePendingConfigRollbackCheck.mockImplementation((sessionId: string) => {
      mocks.effectOrder.push(`schedule-rollback:${sessionId}`);
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
      "clear-summary",
      "schedule-rollback:session-1",
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
      "clear-rollback:session-1",
      "clear-rollback:session-1",
    ]);
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
});

function baseInput(overrides?: {
  pendingConfigChanges?: PendingSessionConfigChanges;
  sessionRelationship?: SessionRelationship | null;
}) {
  const sessionRelationship: SessionRelationship | null =
    overrides?.sessionRelationship ?? { kind: "pending" };
  return {
    queryClient: new QueryClient(),
    sessionId: "session-1",
    runtimeUrl: "http://runtime.test",
    workspaceId: "workspace-1",
    agentKind: "codex",
    envelopes: [] as SessionEventEnvelope[],
    transcript: createTranscriptState("session-1"),
    pendingConfigChanges: overrides?.pendingConfigChanges ?? {},
    reconciledIntents: [],
    mountSubagentChildSession: vi.fn(),
    recordSessionRelationshipHint: vi.fn(),
    getSessionRelationship: vi.fn((sessionId: string) =>
      sessionId === "session-1" ? sessionRelationship : null),
    persistReconciledModePreferences: vi.fn(),
    refreshSessionSlotMeta: vi.fn(),
    showToast: vi.fn(),
    clearActiveSummaryRefreshTimer: vi.fn(),
    scheduleActiveSummaryRefresh: vi.fn(),
    scheduleStartupReadyRefresh: vi.fn(),
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
