import { describe, expect, it } from "vitest";
import {
  collectWorkspaceSessionViewStates,
  resolveSessionViewState,
  shouldSkipColdIdleSessionStream,
  resolveWorkspaceExecutionViewState,
} from "./activity";

describe("session activity", () => {
  it("prefers local pending prompts over remote execution state", () => {
    expect(resolveSessionViewState({
      status: "idle",
      executionSummary: {
        phase: "idle",
        hasLiveHandle: true,
        pendingApproval: null,
        updatedAt: "2026-04-06T00:00:00Z",
      },
      pendingUserPrompt: { text: "hello" },
      streamConnectionState: "open",
      transcript: {
        isStreaming: false,
        pendingApproval: null,
      },
    })).toBe("sending");
  });

  it("maps awaiting permission to needs_input", () => {
    expect(resolveSessionViewState({
      status: "running",
      executionSummary: {
        phase: "awaiting_permission",
        hasLiveHandle: true,
        pendingApproval: {
          requestId: "request-1",
          title: "Approve",
          toolCallId: "tool-1",
          toolKind: "exec",
        },
        updatedAt: "2026-04-06T00:00:00Z",
      },
      pendingUserPrompt: null,
      streamConnectionState: "open",
      transcript: {
        isStreaming: false,
        pendingApproval: { requestId: "request-1" },
      },
    })).toBe("needs_input");
  });

  it("aggregates workspace activity using the expected precedence", () => {
    const states = collectWorkspaceSessionViewStates({
      "session-1": {
        workspaceId: "workspace-1",
        status: "running",
        executionSummary: {
          phase: "running",
          hasLiveHandle: true,
          pendingApproval: null,
          updatedAt: "2026-04-06T00:00:00Z",
        },
        pendingUserPrompt: null,
        streamConnectionState: "open",
        transcript: {
          isStreaming: true,
          pendingApproval: null,
        },
      },
      "session-2": {
        workspaceId: "workspace-1",
        status: "idle",
        executionSummary: {
          phase: "idle",
          hasLiveHandle: false,
          pendingApproval: null,
          updatedAt: "2026-04-06T00:00:01Z",
        },
        pendingUserPrompt: { text: "queued" },
        streamConnectionState: "disconnected",
        transcript: {
          isStreaming: false,
          pendingApproval: null,
        },
      },
    });

    expect(states["workspace-1"]).toBe("sending");
  });

  it("maps workspace summaries to execution view states", () => {
    expect(resolveWorkspaceExecutionViewState({
      phase: "awaiting_permission",
      totalSessionCount: 1,
      liveSessionCount: 1,
      runningCount: 0,
      awaitingPermissionCount: 1,
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
        pendingApproval: null,
        updatedAt: "2026-04-06T00:00:00Z",
      },
      pendingUserPrompt: null,
      streamConnectionState: "disconnected",
      transcript: {
        isStreaming: false,
        pendingApproval: null,
      },
    }, true)).toBe(true);

    expect(shouldSkipColdIdleSessionStream({
      status: "idle",
      executionSummary: {
        phase: "idle",
        hasLiveHandle: true,
        pendingApproval: null,
        updatedAt: "2026-04-06T00:00:00Z",
      },
      pendingUserPrompt: null,
      streamConnectionState: "disconnected",
      transcript: {
        isStreaming: false,
        pendingApproval: null,
      },
    }, true)).toBe(false);
  });
});
