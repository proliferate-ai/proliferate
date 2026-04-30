import { describe, expect, it } from "vitest";
import {
  collectWorkspaceSidebarActivityStates,
  collectWorkspaceSessionViewStates,
  resolveSessionSidebarActivityState,
  resolveSessionViewState,
  shouldSkipColdIdleSessionStream,
  resolveWorkspaceExecutionViewState,
} from "./activity";

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
