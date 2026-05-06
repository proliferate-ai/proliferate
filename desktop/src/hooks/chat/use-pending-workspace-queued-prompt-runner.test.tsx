// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useChatInputStore } from "@/stores/chat/chat-input-store";
import { usePendingWorkspaceQueuedPromptStore } from "@/stores/chat/pending-workspace-queued-prompt-store";
import { usePendingWorkspaceQueuedPromptRunner } from "./use-pending-workspace-queued-prompt-runner";

const runnerMocks = vi.hoisted(() => ({
  createSessionWithResolvedConfig: vi.fn(),
  promptSession: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock("@/hooks/sessions/use-session-actions", () => ({
  useSessionActions: () => ({
    createSessionWithResolvedConfig: runnerMocks.createSessionWithResolvedConfig,
  }),
}));

vi.mock("@/hooks/sessions/use-session-prompt-workflow", () => ({
  useSessionPromptWorkflow: () => ({
    promptSession: runnerMocks.promptSession,
  }),
}));

vi.mock("@/stores/toast/toast-store", () => ({
  useToastStore: (selector: (state: { show: (message: string) => void }) => unknown) =>
    selector({ show: runnerMocks.showToast }),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useChatInputStore.setState({ draftByWorkspaceId: {} });
  usePendingWorkspaceQueuedPromptStore.setState({ queuedPrompts: {} });
});

describe("usePendingWorkspaceQueuedPromptRunner", () => {
  it("marks a materialized queued prompt failed when session creation rejects after consuming", async () => {
    const create = deferred<string>();
    runnerMocks.createSessionWithResolvedConfig.mockReturnValue(create.promise);

    renderHook(() => usePendingWorkspaceQueuedPromptRunner());

    act(() => {
      usePendingWorkspaceQueuedPromptStore.getState().enqueue({
        id: "pending-workspace:attempt-1",
        attemptId: "attempt-1",
        status: "pending",
        workspaceId: "workspace-1",
        sessionId: null,
        agentKind: "codex",
        modelId: "gpt-5.4",
        modeId: null,
        controlValues: {},
        text: "hello",
        blocks: [{ type: "text", text: "hello" }],
        promptId: "prompt-1",
        draftKey: "pending-workspace:attempt-1",
        materializedDraftKey: null,
        createdAt: Date.now(),
        errorMessage: null,
      });
    });

    await waitFor(() => {
      expect(
        usePendingWorkspaceQueuedPromptStore.getState()
          .queuedPrompts["pending-workspace:attempt-1"]?.status,
      ).toBe("consuming");
    });

    act(() => {
      create.reject(new Error("create failed"));
    });

    await waitFor(() => {
      expect(
        usePendingWorkspaceQueuedPromptStore.getState()
          .queuedPrompts["pending-workspace:attempt-1"],
      ).toMatchObject({
        status: "failed",
        errorMessage: "create failed",
      });
    });
    expect(runnerMocks.showToast).toHaveBeenCalledWith(
      "Workspace is ready, but the queued prompt could not be sent: create failed",
    );
  });

  it("clears both pending and materialized drafts when a queued prompt is accepted", async () => {
    runnerMocks.createSessionWithResolvedConfig.mockImplementation(async (options: {
      onBeforeOptimisticPrompt?: () => void;
    }) => {
      options.onBeforeOptimisticPrompt?.();
      return "session-1";
    });

    useChatInputStore.getState().setDraftText("pending-workspace:attempt-1", "hello");
    useChatInputStore.getState().setDraftText("workspace-1", "hello");
    useChatInputStore.getState().setDraftText("logical-1", "hello");

    renderHook(() => usePendingWorkspaceQueuedPromptRunner());

    act(() => {
      usePendingWorkspaceQueuedPromptStore.getState().enqueue({
        id: "pending-workspace:attempt-1",
        attemptId: "attempt-1",
        status: "pending",
        workspaceId: "workspace-1",
        sessionId: null,
        agentKind: "codex",
        modelId: "gpt-5.4",
        modeId: null,
        controlValues: {},
        text: "hello",
        blocks: [{ type: "text", text: "hello" }],
        promptId: "prompt-1",
        draftKey: "pending-workspace:attempt-1",
        materializedDraftKey: "logical-1",
        createdAt: Date.now(),
        errorMessage: null,
      });
    });

    await waitFor(() => {
      expect(
        usePendingWorkspaceQueuedPromptStore.getState()
          .queuedPrompts["pending-workspace:attempt-1"],
      ).toBeUndefined();
    });

    expect(useChatInputStore.getState().draftByWorkspaceId).not.toHaveProperty(
      "pending-workspace:attempt-1",
    );
    expect(useChatInputStore.getState().draftByWorkspaceId).not.toHaveProperty("workspace-1");
    expect(useChatInputStore.getState().draftByWorkspaceId).not.toHaveProperty("logical-1");
  });
});
