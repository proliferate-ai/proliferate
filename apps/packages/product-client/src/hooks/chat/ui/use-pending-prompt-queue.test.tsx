// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VisiblePendingPromptEntry } from "#product/hooks/chat/ui/use-queued-prompt-edit";
import { usePendingPromptQueue } from "#product/hooks/chat/ui/use-pending-prompt-queue";
import { useSessionTranscriptStore } from "#product/stores/sessions/session-transcript-store";

const mocks = vi.hoisted(() => ({
  activeSessionId: "session-1" as string | null,
  pendingPrompts: [] as VisiblePendingPromptEntry[],
  beginEdit: vi.fn(),
  cancelBeforeDispatch: vi.fn(),
  deletePendingPrompt: vi.fn(),
  dismissPrompt: vi.fn(),
  reorderPendingPrompts: vi.fn(),
  showErrorToast: vi.fn(),
  steerPendingPrompt: vi.fn(),
}));

vi.mock("#product/hooks/chat/derived/use-active-session-identity", () => ({
  useActiveSessionId: () => mocks.activeSessionId,
}));

vi.mock("#product/hooks/chat/ui/use-queued-prompt-edit", () => ({
  useQueuedPromptEditReader: () => ({
    visiblePendingPrompts: mocks.pendingPrompts,
    beginEdit: mocks.beginEdit,
  }),
}));

vi.mock("#product/hooks/chat/workflows/use-prompt-outbox-actions", () => ({
  usePromptOutboxActions: () => ({
    cancelBeforeDispatch: mocks.cancelBeforeDispatch,
    dismissPrompt: mocks.dismissPrompt,
  }),
}));

vi.mock("#product/hooks/sessions/workflows/use-delete-pending-prompt", () => ({
  useDeletePendingPrompt: () => mocks.deletePendingPrompt,
}));

vi.mock("#product/hooks/sessions/workflows/use-reorder-pending-prompts", () => ({
  useReorderPendingPrompts: () => mocks.reorderPendingPrompts,
}));

vi.mock("#product/hooks/sessions/workflows/use-steer-pending-prompt", () => ({
  useSteerPendingPrompt: () => mocks.steerPendingPrompt,
}));

vi.mock("#product/stores/sessions/session-directory-store", () => ({
  useSessionDirectoryStore: (
    selector: (state: { entriesById: Record<string, { materializedSessionId: string }> }) => unknown,
  ) => selector({
    entriesById: {
      "session-1": { materializedSessionId: "runtime-session-1" },
      "session-2": { materializedSessionId: "runtime-session-2" },
    },
  }),
}));

vi.mock("#product/stores/toast/toast-store", () => ({
  useToastStore: (
    selector: (state: { showError: (input: unknown) => void }) => unknown,
  ) => selector({ showError: mocks.showErrorToast }),
}));

function prompt(
  seq: number,
  text: string,
  promptId: string | null = "duplicate-id",
): VisiblePendingPromptEntry {
  return {
    seq,
    promptId,
    text,
    contentParts: [],
    queuedAt: "2026-07-11T00:00:00Z",
    isBeingEdited: false,
  };
}

function agentPrompt(seq: number, sessionId: string): VisiblePendingPromptEntry {
  return {
    ...prompt(seq, "Hidden agent update"),
    promptProvenance: {
      type: "agentSession",
      sourceSessionId: sessionId,
      label: `Agent ${sessionId}`,
    },
  };
}

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
} {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("usePendingPromptQueue", () => {
  beforeEach(() => {
    mocks.activeSessionId = "session-1";
    mocks.pendingPrompts = [prompt(1, "first"), prompt(2, "second")];
    mocks.beginEdit.mockReset();
    mocks.cancelBeforeDispatch.mockReset();
    mocks.deletePendingPrompt.mockReset();
    mocks.dismissPrompt.mockReset();
    mocks.reorderPendingPrompts.mockReset().mockResolvedValue(undefined);
    mocks.showErrorToast.mockReset();
    mocks.steerPendingPrompt.mockReset().mockResolvedValue(undefined);
    useSessionTranscriptStore.getState().clearEntries();
    useSessionTranscriptStore.getState().ensureEntry("session-1");
  });

  afterEach(() => {
    cleanup();
    useSessionTranscriptStore.getState().clearEntries();
  });

  it("ignores unrelated transcript clones and updates only when link completions change", () => {
    mocks.pendingPrompts = [{
      ...prompt(9, "Hidden wake update"),
      promptProvenance: {
        type: "subagentWake",
        sessionLinkId: "link-1",
        completionId: "completion-1",
        label: "Schema audit",
      },
    }];
    let renderCount = 0;
    const rendered = renderHook(() => {
      renderCount += 1;
      return usePendingPromptQueue();
    });
    const initialRenderCount = renderCount;
    expect(rendered.result.current.rows[0]?.agents).toEqual([]);

    const before = useSessionTranscriptStore.getState().entriesById["session-1"]!.transcript;
    act(() => {
      useSessionTranscriptStore.getState().patchEntry("session-1", {
        transcript: {
          ...before,
          currentModeId: "unrelated-stream-update",
        },
      });
    });
    expect(renderCount).toBe(initialRenderCount);

    const afterUnrelated = useSessionTranscriptStore.getState()
      .entriesById["session-1"]!.transcript;
    act(() => {
      useSessionTranscriptStore.getState().patchEntry("session-1", {
        transcript: {
          ...afterUnrelated,
          linkCompletionsByCompletionId: {
            "completion-1": {
              relation: "subagent",
              completionId: "completion-1",
              sessionLinkId: "link-1",
              parentSessionId: "session-1",
              childSessionId: "durable-child",
              childTurnId: "turn-child",
              childLastEventSeq: 8,
              outcome: "completed",
              label: "Schema audit",
              seq: 9,
              timestamp: "2026-08-10T00:00:00Z",
            },
          },
        },
      });
    });

    expect(renderCount).toBeGreaterThan(initialRenderCount);
    expect(rendered.result.current.rows[0]?.agents).toEqual([
      expect.objectContaining({ sessionId: "durable-child", title: "Schema audit" }),
    ]);
  });

  it("sends compare-and-swap orders and keeps duplicate prompt IDs distinct optimistically", async () => {
    const pending = deferred();
    mocks.reorderPendingPrompts.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => usePendingPromptQueue());
    const firstRow = result.current.rows[0]!;

    act(() => {
      result.current.onReorder(0, 1);
      result.current.onReorder(0, 1);
      result.current.onSteer(firstRow);
    });

    expect(mocks.reorderPendingPrompts).toHaveBeenCalledWith(
      "session-1",
      [1, 2],
      [2, 1],
    );
    expect(mocks.reorderPendingPrompts).toHaveBeenCalledTimes(1);
    expect(mocks.steerPendingPrompt).not.toHaveBeenCalled();
    expect(result.current.rows.map((row) => row.seq)).toEqual([2, 1]);
    expect(result.current.rows.map((row) => row.key)).toEqual(["seq:2", "seq:1"]);
    expect(result.current.queueMutationInFlight).toBe(true);

    await act(async () => pending.resolve());
  });

  it("keeps steer progress on immutable seq and blocks reorder while steering", async () => {
    const pending = deferred();
    mocks.steerPendingPrompt.mockReturnValueOnce(pending.promise);
    const rendered = renderHook(() => usePendingPromptQueue());

    act(() => rendered.result.current.onSteer(rendered.result.current.rows[1]!));
    expect(rendered.result.current.steeringSeq).toBe(2);
    expect(rendered.result.current.queueMutationInFlight).toBe(true);

    mocks.pendingPrompts = [prompt(2, "second"), prompt(1, "first")];
    rendered.rerender();

    expect(rendered.result.current.rows.map((row) => row.seq)).toEqual([2, 1]);
    expect(rendered.result.current.steeringSeq).toBe(2);
    act(() => rendered.result.current.onReorder(0, 1));
    expect(mocks.reorderPendingPrompts).not.toHaveBeenCalled();

    await act(async () => pending.resolve());
    expect(rendered.result.current.steeringSeq).toBeNull();
  });

  it("scopes mutation progress and locks to the session that started them", async () => {
    const sessionOneSteer = deferred();
    const sessionTwoReorder = deferred();
    mocks.steerPendingPrompt.mockReturnValueOnce(sessionOneSteer.promise);
    mocks.reorderPendingPrompts.mockReturnValueOnce(sessionTwoReorder.promise);
    const rendered = renderHook(() => usePendingPromptQueue());

    act(() => rendered.result.current.onSteer(rendered.result.current.rows[0]!));
    expect(rendered.result.current.steeringSeq).toBe(1);

    mocks.activeSessionId = "session-2";
    mocks.pendingPrompts = [prompt(1, "session two first"), prompt(2, "session two second")];
    rendered.rerender();

    expect(rendered.result.current.steeringSeq).toBeNull();
    expect(rendered.result.current.queueMutationInFlight).toBe(false);
    act(() => rendered.result.current.onReorder(0, 1));
    expect(mocks.reorderPendingPrompts).toHaveBeenCalledWith(
      "session-2",
      [1, 2],
      [2, 1],
    );
    expect(rendered.result.current.rows.map((row) => row.seq)).toEqual([2, 1]);

    mocks.activeSessionId = "session-1";
    mocks.pendingPrompts = [prompt(1, "session one first"), prompt(2, "session one second")];
    rendered.rerender();
    expect(rendered.result.current.steeringSeq).toBe(1);
    expect(rendered.result.current.queueMutationInFlight).toBe(true);

    await act(async () => sessionTwoReorder.resolve());
    expect(rendered.result.current.steeringSeq).toBe(1);
    expect(rendered.result.current.queueMutationInFlight).toBe(true);

    await act(async () => sessionOneSteer.resolve());
    expect(rendered.result.current.queueMutationInFlight).toBe(false);
  });

  it("reports failures as an outcome plus a cause, never one concatenated line", async () => {
    mocks.steerPendingPrompt.mockRejectedValueOnce(new Error("steer conflict"));
    const rendered = renderHook(() => usePendingPromptQueue());

    act(() => rendered.result.current.onSteer(rendered.result.current.rows[0]!));
    await waitFor(() => expect(rendered.result.current.queueMutationInFlight).toBe(false));
    // The headline stays a written line and the exception stays in `cause`, so
    // no width of toast can clip "steer conflict" into the sentence a person
    // reads. That is the bug this shape exists to make unwritable.
    const steerCall = mocks.showErrorToast.mock.calls[0]![0] as {
      headline: string;
      consequence: string;
      cause: string;
    };
    expect(steerCall.headline).toBe("Message not sent next");
    expect(steerCall.headline).not.toContain("steer conflict");
    expect(steerCall.consequence).toBe("It is still queued in its original position.");
    expect(steerCall.cause).toBe("steer conflict");

    mocks.reorderPendingPrompts.mockRejectedValueOnce(new Error("queue changed"));
    act(() => rendered.result.current.onReorder(0, 1));
    await waitFor(() => expect(rendered.result.current.queueMutationInFlight).toBe(false));
    const reorderCall = mocks.showErrorToast.mock.calls[1]![0] as {
      headline: string;
      cause: string;
    };
    expect(reorderCall.headline).toBe("Queue order not changed");
    expect(reorderCall.cause).toBe("queue changed");
    expect(rendered.result.current.rows.map((row) => row.seq)).toEqual([1, 2]);
  });

  it("offers a retry that re-runs the attempt that failed", async () => {
    mocks.steerPendingPrompt.mockRejectedValueOnce(new Error("steer conflict"));
    const rendered = renderHook(() => usePendingPromptQueue());

    act(() => rendered.result.current.onSteer(rendered.result.current.rows[0]!));
    await waitFor(() => expect(rendered.result.current.queueMutationInFlight).toBe(false));
    expect(mocks.steerPendingPrompt).toHaveBeenCalledTimes(1);

    const { retry } = mocks.showErrorToast.mock.calls[0]![0] as { retry: () => void };
    await act(async () => {
      retry();
    });

    expect(mocks.steerPendingPrompt).toHaveBeenCalledTimes(2);
    expect(mocks.steerPendingPrompt).toHaveBeenLastCalledWith("session-1", 1);
  });

  it("edits a runtime prompt without requiring promptId", () => {
    mocks.pendingPrompts = [prompt(7, "editable", null)];
    const { result } = renderHook(() => usePendingPromptQueue());

    act(() => result.current.onBeginEdit(result.current.rows[0]!));

    expect(mocks.beginEdit).toHaveBeenCalledWith({ seq: 7, text: "editable" });
  });

  it("reorders user rows through the full runtime order without moving hidden agent slots", async () => {
    const pending = deferred();
    mocks.reorderPendingPrompts.mockReturnValueOnce(pending.promise);
    mocks.pendingPrompts = [
      prompt(1, "user A"),
      agentPrompt(2, "agent-X"),
      prompt(3, "user B"),
      agentPrompt(4, "agent-Y"),
    ];
    const { result } = renderHook(() => usePendingPromptQueue());

    expect(result.current.rows.map((row) => row.kind)).toEqual([
      "plain",
      "plain",
      "agent_updates",
    ]);
    act(() => result.current.onReorder(0, 1));

    expect(mocks.reorderPendingPrompts).toHaveBeenCalledWith(
      "session-1",
      [1, 2, 3, 4],
      [3, 2, 1, 4],
    );
    expect(result.current.rows.map((row) => row.seq)).toEqual([3, 1, 0]);

    await act(async () => pending.resolve());
  });

  it("preserves review and local slots in optimistic order while keeping agent updates last", async () => {
    const pending = deferred();
    mocks.reorderPendingPrompts.mockReturnValueOnce(pending.promise);
    mocks.pendingPrompts = [
      prompt(1, "user A"),
      {
        ...prompt(2, "Review feedback is ready."),
        promptProvenance: {
          type: "reviewFeedback",
          reviewRunId: "run-1",
          reviewRoundId: "round-1",
          feedbackJobId: "job-1",
        },
      },
      prompt(-3, "local outbox"),
      prompt(4, "user B"),
      agentPrompt(5, "agent-X"),
    ];
    const rendered = renderHook(() => usePendingPromptQueue());

    expect(rendered.result.current.rows.map((row) => row.seq)).toEqual([1, 2, -3, 4, 0]);
    act(() => rendered.result.current.onReorder(0, 3));

    expect(mocks.reorderPendingPrompts).toHaveBeenCalledWith(
      "session-1",
      [1, 2, 4, 5],
      [4, 2, 1, 5],
    );
    expect(rendered.result.current.rows.map((row) => row.seq)).toEqual([4, 2, -3, 1, 0]);

    mocks.pendingPrompts = [
      prompt(1, "user A"),
      {
        ...prompt(2, "Review feedback is ready."),
        promptProvenance: {
          type: "reviewFeedback",
          reviewRunId: "run-1",
          reviewRoundId: "round-1",
          feedbackJobId: "job-1",
        },
      },
      prompt(-3, "local outbox"),
      prompt(4, "user B"),
      prompt(6, "new user C"),
      agentPrompt(5, "agent-X"),
    ];
    rendered.rerender();
    expect(rendered.result.current.rows.map((row) => row.seq)).toEqual([4, 2, -3, 1, 6, 0]);

    await act(async () => pending.resolve());
  });
});
