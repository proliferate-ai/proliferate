import { describe, expect, it, vi } from "vitest";
import type { WorkspaceArrivalEvent } from "@/lib/domain/workspaces/creation/arrival";
import { completeChatPromptSubmitSideEffects } from "./complete-chat-prompt-submit-side-effects";

function arrival(
  overrides: Partial<WorkspaceArrivalEvent> = {},
): WorkspaceArrivalEvent {
  return {
    workspaceId: "workspace-1",
    source: "local-created",
    setupScript: null,
    createdAt: 1,
    ...overrides,
  };
}

describe("completeChatPromptSubmitSideEffects", () => {
  it("reads the current workspace arrival event when completion runs", () => {
    let currentArrival: WorkspaceArrivalEvent | null = arrival({
      setupScript: {
        status: "running",
      } as WorkspaceArrivalEvent["setupScript"],
    });
    const setWorkspaceArrivalEvent = vi.fn();
    const trackProductEvent = vi.fn();

    completeChatPromptSubmitSideEffects({
      workspaceId: "workspace-1",
      getWorkspaceArrivalEvent: () => currentArrival,
      getCachedWorkspaceSetupStatus: () => null,
      agentKind: "test-agent",
      reuseSession: false,
      setWorkspaceArrivalEvent,
    }, { trackProductEvent });
    expect(setWorkspaceArrivalEvent).not.toHaveBeenCalled();

    currentArrival = null;
    completeChatPromptSubmitSideEffects({
      workspaceId: "workspace-1",
      getWorkspaceArrivalEvent: () => currentArrival,
      getCachedWorkspaceSetupStatus: () => null,
      agentKind: "test-agent",
      reuseSession: false,
      setWorkspaceArrivalEvent,
    }, { trackProductEvent });
    expect(setWorkspaceArrivalEvent).toHaveBeenCalledWith(null);
  });

  it("tracks submitted prompt telemetry with workspace kind", () => {
    const trackProductEvent = vi.fn();

    completeChatPromptSubmitSideEffects({
      workspaceId: "cloud:workspace-1",
      getWorkspaceArrivalEvent: () => null,
      getCachedWorkspaceSetupStatus: () => null,
      agentKind: "test-agent",
      reuseSession: true,
      setWorkspaceArrivalEvent: vi.fn(),
    }, { trackProductEvent });

    expect(trackProductEvent).toHaveBeenCalledWith("chat_prompt_submitted", {
      workspace_kind: "cloud",
      agent_kind: "test-agent",
      reuse_session: true,
    });
  });
});
