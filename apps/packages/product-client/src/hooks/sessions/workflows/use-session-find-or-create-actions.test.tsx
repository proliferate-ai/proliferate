// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionFindOrCreateActions } from "#product/hooks/sessions/workflows/use-session-find-or-create-actions";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { useSessionTranscriptStore } from "#product/stores/sessions/session-transcript-store";

const workflowMocks = vi.hoisted(() => ({
  promptSession: vi.fn(),
  selectSessionWithShellIntentRollback: vi.fn(),
}));

vi.mock("#product/hooks/sessions/workflows/use-session-prompt-workflow", () => ({
  useSessionPromptWorkflow: () => ({ promptSession: workflowMocks.promptSession }),
}));

vi.mock("#product/hooks/sessions/workflows/session-shell-selection", () => ({
  selectSessionWithShellIntentRollback:
    workflowMocks.selectSessionWithShellIntentRollback,
}));

vi.mock("#product/hooks/workspaces/derived/use-workspace-runtime-block", () => ({
  useWorkspaceRuntimeBlock: () => ({
    getWorkspaceRuntimeBlockReason: () => null,
  }),
}));

afterEach(cleanup);

describe("useSessionFindOrCreateActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionDirectoryStore.getState().clearEntries();
    useSessionTranscriptStore.getState().clearEntries();
  });

  it("prompts the client identity returned by guarded backend selection", async () => {
    const clientSessionId = "client-session:codex:existing";
    const runtimeSessionId = "runtime-session-existing";
    workflowMocks.selectSessionWithShellIntentRollback.mockResolvedValueOnce({
      result: "completed",
      sessionId: clientSessionId,
      guard: {
        workspaceId: "workspace-1",
        workspaceSelectionNonce: 1,
        token: 1,
      },
      activeSessionVersion: 1,
    });
    const createSessionWithResolvedConfig = vi.fn();
    const { result } = renderHook(() => useSessionFindOrCreateActions({
      activateSession: vi.fn(),
      createSessionWithResolvedConfig,
      ensureWorkspaceSessions: vi.fn().mockResolvedValue([{
        id: runtimeSessionId,
        agentKind: "codex",
        modelId: "gpt-5",
        workspaceId: "workspace-1",
      }]),
      selectSession: vi.fn(),
    }));

    await act(async () => {
      await result.current.findOrCreateSessionForLaunch({
        workspaceId: "workspace-1",
        agentKind: "codex",
        modelId: "gpt-5",
        text: "Continue",
      });
    });

    expect(workflowMocks.promptSession).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: clientSessionId,
      workspaceId: "workspace-1",
      text: "Continue",
    }));
    expect(createSessionWithResolvedConfig).not.toHaveBeenCalled();
  });
});
