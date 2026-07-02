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

function makeDeps() {
  return {
    trackProductEvent: vi.fn(),
    captureGitStatusSnapshot: vi.fn(),
    stampGitPrompt: vi.fn(),
    refreshPrStatuses: vi.fn(),
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

    completeChatPromptSubmitSideEffects({
      workspaceId: "workspace-1",
      logicalWorkspaceId: null,
      repoRootId: null,
      getWorkspaceArrivalEvent: () => currentArrival,
      getCachedWorkspaceSetupStatus: () => null,
      agentKind: "test-agent",
      reuseSession: false,
      setWorkspaceArrivalEvent,
    }, makeDeps());
    expect(setWorkspaceArrivalEvent).not.toHaveBeenCalled();

    currentArrival = null;
    completeChatPromptSubmitSideEffects({
      workspaceId: "workspace-1",
      logicalWorkspaceId: null,
      repoRootId: null,
      getWorkspaceArrivalEvent: () => currentArrival,
      getCachedWorkspaceSetupStatus: () => null,
      agentKind: "test-agent",
      reuseSession: false,
      setWorkspaceArrivalEvent,
    }, makeDeps());
    expect(setWorkspaceArrivalEvent).toHaveBeenCalledWith(null);
  });

  it("tracks submitted prompt telemetry with workspace kind", () => {
    const deps = makeDeps();

    completeChatPromptSubmitSideEffects({
      workspaceId: "cloud:workspace-1",
      logicalWorkspaceId: null,
      repoRootId: null,
      getWorkspaceArrivalEvent: () => null,
      getCachedWorkspaceSetupStatus: () => null,
      agentKind: "test-agent",
      reuseSession: true,
      setWorkspaceArrivalEvent: vi.fn(),
    }, deps);

    expect(deps.trackProductEvent).toHaveBeenCalledWith("chat_prompt_submitted", {
      workspace_kind: "cloud",
      agent_kind: "test-agent",
      reuse_session: true,
    });
  });

  it("captures the git snapshot, stamps the prompt, and refreshes PR status", () => {
    const deps = makeDeps();

    completeChatPromptSubmitSideEffects({
      workspaceId: "workspace-1",
      logicalWorkspaceId: "repo-root:root-1:main",
      repoRootId: "root-1",
      getWorkspaceArrivalEvent: () => null,
      getCachedWorkspaceSetupStatus: () => null,
      agentKind: "test-agent",
      reuseSession: true,
      setWorkspaceArrivalEvent: vi.fn(),
    }, deps);

    expect(deps.captureGitStatusSnapshot).toHaveBeenCalledWith(
      "repo-root:root-1:main",
      expect.any(String),
    );
    expect(deps.stampGitPrompt).toHaveBeenCalledWith(
      "repo-root:root-1:main",
      deps.captureGitStatusSnapshot.mock.calls[0]?.[1],
    );
    expect(deps.refreshPrStatuses).toHaveBeenCalledWith("root-1");
  });

  it("skips git side effects without a logical workspace or repo root", () => {
    const deps = makeDeps();

    completeChatPromptSubmitSideEffects({
      workspaceId: "workspace-1",
      logicalWorkspaceId: null,
      repoRootId: null,
      getWorkspaceArrivalEvent: () => null,
      getCachedWorkspaceSetupStatus: () => null,
      agentKind: "test-agent",
      reuseSession: false,
      setWorkspaceArrivalEvent: vi.fn(),
    }, deps);

    expect(deps.captureGitStatusSnapshot).not.toHaveBeenCalled();
    expect(deps.stampGitPrompt).not.toHaveBeenCalled();
    expect(deps.refreshPrStatuses).not.toHaveBeenCalled();
  });
});
