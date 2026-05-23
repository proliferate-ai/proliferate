import { describe, expect, it } from "vitest";
import {
  collectWorkspaceSidebarActivityStatesWithErrorAttention,
  collectWorkspaceSidebarActivityStates,
  collectSessionActivityReconciliationIds,
  collectWorkspaceSessionViewStates,
  resolveSessionErrorAttentionKey,
  resolveSessionSidebarActivityState,
  resolveSessionViewState,
  shouldSkipColdIdleSessionStream,
  resolveWorkspaceExecutionViewState,
} from "./activity";

function executionSummary(phase: "running" | "awaiting_interaction" | "errored" | "idle") {
  return {
    phase,
    hasLiveHandle: phase === "running" || phase === "awaiting_interaction",
    pendingInteractions: [],
    updatedAt: "2026-04-06T00:00:00Z",
  };
}

function sidebarSlot({
  sessionId,
  workspaceId = "workspace-1",
  status,
  phase,
  errorAttentionKey,
  isStreaming = false,
}: {
  sessionId: string;
  workspaceId?: string;
  status: "running" | "idle" | "errored";
  phase: "running" | "awaiting_interaction" | "errored" | "idle";
  errorAttentionKey: string | null;
  isStreaming?: boolean;
}) {
  const streamConnectionState: "open" | "ended" = isStreaming ? "open" : "ended";
  return {
    sessionId,
    workspaceId,
    status,
    executionSummary: executionSummary(phase),
    streamConnectionState,
    transcript: {
      isStreaming,
      pendingInteractions: [],
    },
    errorAttentionKey,
  };
}

describe("session activity", () => {
  it("maps awaiting interaction to needs_input", () => {
    expect(resolveSessionViewState({
      status: "running",
      executionSummary: {
        phase: "awaiting_interaction",
        hasLiveHandle: true,
        pendingInteractions: [{
          requestId: "request-1",
          kind: "permission",
          title: "Approve",
          description: null,
          source: { toolCallId: "tool-1", toolKind: "exec", toolStatus: null },
          payload: { type: "permission", options: [] },
        }],
        updatedAt: "2026-04-06T00:00:00Z",
      },
      streamConnectionState: "open",
      transcript: {
        isStreaming: false,
        pendingInteractions: [{ requestId: "request-1" }],
      },
    })).toBe("needs_input");
  });

  it("does not treat plan-owned native permissions as session activity", () => {
    expect(resolveSessionViewState({
      status: "running",
      executionSummary: {
        phase: "awaiting_interaction",
        hasLiveHandle: true,
        pendingInteractions: [{
          requestId: "request-1",
          kind: "permission",
          title: "Ready to code?",
          description: null,
          source: {
            toolCallId: "tool-1",
            toolKind: "switch_mode",
            toolStatus: null,
            linkedPlanId: "plan-1",
          },
          payload: { type: "permission", options: [] },
        }],
        updatedAt: "2026-04-06T00:00:00Z",
      },
      streamConnectionState: "open",
      transcript: {
        isStreaming: false,
        pendingInteractions: [{ requestId: "request-1", linkedPlanId: "plan-1" }],
      },
    })).toBe("idle");
  });

  it("surfaces plan-owned native permissions as sidebar plan waiting", () => {
    expect(resolveSessionSidebarActivityState({
      status: "running",
      executionSummary: {
        phase: "awaiting_interaction",
        hasLiveHandle: true,
        pendingInteractions: [{
          requestId: "request-1",
          kind: "permission",
          title: "Ready to code?",
          description: null,
          source: {
            toolCallId: "tool-1",
            toolKind: "switch_mode",
            toolStatus: null,
            linkedPlanId: "plan-1",
          },
          payload: { type: "permission", options: [] },
        }],
        updatedAt: "2026-04-06T00:00:00Z",
      },
      streamConnectionState: "open",
      transcript: {
        isStreaming: false,
        pendingInteractions: [{ requestId: "request-1", linkedPlanId: "plan-1" }],
      },
    })).toBe("waiting_plan");
  });

  it("aggregates workspace activity using the expected precedence", () => {
    const states = collectWorkspaceSessionViewStates({
      "session-1": {
        workspaceId: "workspace-1",
        status: "running",
        executionSummary: {
          phase: "running",
          hasLiveHandle: true,
          pendingInteractions: [],
          updatedAt: "2026-04-06T00:00:00Z",
        },
        streamConnectionState: "open",
        transcript: {
          isStreaming: true,
          pendingInteractions: [],
        },
      },
      "session-2": {
        workspaceId: "workspace-1",
        status: "idle",
        executionSummary: {
          phase: "awaiting_interaction",
          hasLiveHandle: true,
          pendingInteractions: [{
            requestId: "request-1",
            kind: "permission",
            title: "Approve",
            description: null,
            source: { toolCallId: "tool-1", toolKind: "exec", toolStatus: null },
            payload: { type: "permission", options: [] },
          }],
          updatedAt: "2026-04-06T00:00:01Z",
        },
        streamConnectionState: "open",
        transcript: {
          isStreaming: false,
          pendingInteractions: [{ requestId: "request-1" }],
        },
      },
    });

    expect(states["workspace-1"]).toBe("needs_input");
  });

  it("aggregates sidebar workspace activity with errors above waiting and iterating", () => {
    const states = collectWorkspaceSidebarActivityStates({
      "session-1": {
        workspaceId: "workspace-1",
        status: "running",
        executionSummary: {
          phase: "running",
          hasLiveHandle: true,
          pendingInteractions: [],
          updatedAt: "2026-04-06T00:00:00Z",
        },
        streamConnectionState: "open",
        transcript: {
          isStreaming: true,
          pendingInteractions: [],
        },
      },
      "session-2": {
        workspaceId: "workspace-1",
        status: "idle",
        executionSummary: {
          phase: "awaiting_interaction",
          hasLiveHandle: true,
          pendingInteractions: [{
            requestId: "request-1",
            kind: "permission",
            title: "Approve",
            description: null,
            source: { toolCallId: "tool-1", toolKind: "exec", toolStatus: null },
            payload: { type: "permission", options: [] },
          }],
          updatedAt: "2026-04-06T00:00:01Z",
        },
        streamConnectionState: "open",
        transcript: {
          isStreaming: false,
          pendingInteractions: [{ requestId: "request-1" }],
        },
      },
      "session-3": {
        workspaceId: "workspace-1",
        status: "errored",
        executionSummary: {
          phase: "errored",
          hasLiveHandle: false,
          pendingInteractions: [],
          updatedAt: "2026-04-06T00:00:02Z",
        },
        streamConnectionState: "ended",
        transcript: {
          isStreaming: false,
          pendingInteractions: [],
        },
      },
    });

    expect(states["workspace-1"]).toBe("error");
  });

  it("derives error attention keys from the latest transcript error item only", () => {
    const itemsById = {
      "error-old": {
        kind: "error",
        itemId: "error-old",
        startedSeq: 10,
        completedSeq: 10,
      },
      "error-new": {
        kind: "error",
        itemId: "error-new",
        startedSeq: 20,
        completedSeq: null,
      },
    };
    const key = resolveSessionErrorAttentionKey({
      sessionId: "session-1",
      status: "errored",
      executionSummary: executionSummary("errored"),
      transcript: {
        itemsById,
      },
    });

    expect(key).toBe("error-item:error-new");
  });

  it("falls back to a stable summary terminal key for summary-only errors", () => {
    expect(resolveSessionErrorAttentionKey({
      sessionId: "session-1",
      status: "errored",
      executionSummary: executionSummary("errored"),
      transcript: { itemsById: {} },
    })).toBe("summary-terminal:session-1");
  });

  it("leaves status-only errored sessions unacknowledgeable until an error key exists", () => {
    expect(resolveSessionErrorAttentionKey({
      sessionId: "session-1",
      status: "errored",
      executionSummary: null,
      transcript: { itemsById: {} },
    })).toBeNull();
  });

  it("suppresses viewed errored slots before workspace sidebar priority aggregation", () => {
    const states = collectWorkspaceSidebarActivityStatesWithErrorAttention({
      "session-1": sidebarSlot({
        sessionId: "session-1",
        status: "errored",
        phase: "errored",
        errorAttentionKey: "error-item:error-1",
      }),
      "session-2": sidebarSlot({
        sessionId: "session-2",
        status: "running",
        phase: "running",
        errorAttentionKey: null,
        isStreaming: true,
      }),
    }, {
      "session-1": "error-item:error-1",
    });

    expect(states["workspace-1"]).toBe("iterating");
  });

  it("keeps unviewed and unknown errored slots red", () => {
    const states = collectWorkspaceSidebarActivityStatesWithErrorAttention({
      "session-1": sidebarSlot({
        sessionId: "session-1",
        status: "errored",
        phase: "errored",
        errorAttentionKey: "error-item:error-1",
      }),
      "session-2": sidebarSlot({
        sessionId: "session-2",
        status: "errored",
        phase: "errored",
        errorAttentionKey: null,
      }),
    }, {
      "session-1": "error-item:error-1",
    });

    expect(states["workspace-1"]).toBe("error");
  });

  it("re-shows red when the same session gets a later transcript error key", () => {
    const states = collectWorkspaceSidebarActivityStatesWithErrorAttention({
      "session-1": sidebarSlot({
        sessionId: "session-1",
        status: "errored",
        phase: "errored",
        errorAttentionKey: "error-item:error-2",
      }),
    }, {
      "session-1": "error-item:error-1",
    });

    expect(states["workspace-1"]).toBe("error");
  });

  it("keeps the attention fold input narrow", () => {
    const states = collectWorkspaceSidebarActivityStatesWithErrorAttention({
      "session-1": {
        sessionId: "session-1",
        workspaceId: "workspace-1",
        status: "errored",
        executionSummary: executionSummary("errored"),
        transcript: {
          isStreaming: false,
          pendingInteractions: [],
        },
        errorAttentionKey: "summary-terminal:session-1",
      },
    }, {
      "session-1": "summary-terminal:session-1",
    });

    expect(states["workspace-1"]).toBe("idle");
  });

  it("collects active sessions for runtime summary reconciliation", () => {
    const ids = collectSessionActivityReconciliationIds({
      "session-idle": sidebarSlot({
        sessionId: "session-idle",
        status: "idle",
        phase: "idle",
        errorAttentionKey: null,
      }),
      "session-working": sidebarSlot({
        sessionId: "session-working",
        status: "running",
        phase: "running",
        errorAttentionKey: null,
        isStreaming: true,
      }),
      "session-input": {
        ...sidebarSlot({
          sessionId: "session-input",
          status: "running",
          phase: "awaiting_interaction",
          errorAttentionKey: null,
        }),
        executionSummary: {
          phase: "awaiting_interaction",
          hasLiveHandle: true,
          pendingInteractions: [{
            requestId: "request-1",
            kind: "permission",
            title: "Approve",
            description: null,
            source: { toolCallId: "tool-1", toolKind: "exec", toolStatus: null },
            payload: { type: "permission", options: [] },
          }],
          updatedAt: "2026-04-06T00:00:01Z",
        },
        transcript: {
          isStreaming: false,
          pendingInteractions: [{ requestId: "request-1" }],
        },
      },
      "session-plan": {
        ...sidebarSlot({
          sessionId: "session-plan",
          status: "running",
          phase: "awaiting_interaction",
          errorAttentionKey: null,
        }),
        executionSummary: {
          phase: "awaiting_interaction",
          hasLiveHandle: true,
          pendingInteractions: [{
            requestId: "request-2",
            kind: "permission",
            title: "Ready to code?",
            description: null,
            source: {
              toolCallId: "tool-2",
              toolKind: "switch_mode",
              toolStatus: null,
              linkedPlanId: "plan-1",
            },
            payload: { type: "permission", options: [] },
          }],
          updatedAt: "2026-04-06T00:00:02Z",
        },
        transcript: {
          isStreaming: false,
          pendingInteractions: [{ requestId: "request-2", linkedPlanId: "plan-1" }],
        },
      },
    });

    expect(ids).toEqual(["session-input", "session-plan", "session-working"]);
  });

  it("maps workspace summaries to execution view states", () => {
    expect(resolveWorkspaceExecutionViewState({
      phase: "awaiting_interaction",
      totalSessionCount: 1,
      liveSessionCount: 1,
      runningCount: 0,
      awaitingInteractionCount: 1,
      idleCount: 0,
      erroredCount: 0,
    })).toBe("needs_input");
  });

  it("skips the initial restore stream only for cold idle sessions", () => {
    expect(shouldSkipColdIdleSessionStream({
      status: "idle",
      executionSummary: {
        phase: "idle",
        hasLiveHandle: false,
        pendingInteractions: [],
        updatedAt: "2026-04-06T00:00:00Z",
      },
      streamConnectionState: "disconnected",
      transcript: {
        isStreaming: false,
        pendingInteractions: [],
      },
    }, true)).toBe(true);

    expect(shouldSkipColdIdleSessionStream({
      status: "idle",
      executionSummary: {
        phase: "idle",
        hasLiveHandle: true,
        pendingInteractions: [],
        updatedAt: "2026-04-06T00:00:00Z",
      },
      streamConnectionState: "disconnected",
      transcript: {
        isStreaming: false,
        pendingInteractions: [],
      },
    }, true)).toBe(false);
  });
});
