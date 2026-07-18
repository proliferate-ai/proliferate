// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  forgetSessionGoalIntent,
  recordSessionGoalMutation,
} from "#product/hooks/sessions/workflows/session-goal-lifecycle";
import { useSessionGoalActions } from "#product/hooks/activity/workflows/use-session-goal-actions";
import { useSessionCancelActions } from "#product/hooks/sessions/workflows/use-session-cancel-actions";

const mocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  clearGoal: vi.fn(),
  setGoal: vi.fn(),
  patchSessionRecord: vi.fn(),
  showToast: vi.fn(),
  resolveSession: vi.fn(async () => ({
    materializedSessionId: "runtime-1",
    workspaceId: "workspace-1",
  })),
  record: null as any,
  selection: {
    activeSessionId: "client-1" as string | null,
    selectedWorkspaceId: "workspace-1" as string | null,
  },
  goalBarAction: vi.fn(),
}));

vi.mock("@anyharness/sdk-react", () => ({
  useCancelSessionMutation: () => ({ mutateAsync: mocks.cancel, isPending: false }),
  useClearSessionGoalMutation: () => ({ mutateAsync: mocks.clearGoal, isPending: false }),
  useSetSessionGoalMutation: () => ({ mutateAsync: mocks.setGoal, isPending: false }),
}));

vi.mock("@proliferate/product-client/host/ProductHostProvider", () => ({
  useProductHost: () => ({
    desktop: null,
    cloud: { client: {} },
  }),
}));

vi.mock("#product/hooks/workspaces/derived/use-workspace-runtime-block", () => ({
  useWorkspaceRuntimeBlock: () => ({
    getWorkspaceRuntimeBlockReason: vi.fn(() => null),
  }),
}));

vi.mock("#product/hooks/chat/derived/use-active-session-identity", () => ({
  useActiveSessionId: () => mocks.selection.activeSessionId,
}));

vi.mock("#product/stores/activity/goal-bar-store", () => ({
  goalResultDismissKey: (status: string, updatedAtMs: number) => `${status}:${updatedAtMs}`,
  useGoalBarStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    beginComposing: mocks.goalBarAction,
    endComposing: mocks.goalBarAction,
    dismissResult: mocks.goalBarAction,
    setPendingGoal: mocks.goalBarAction,
    clearPendingGoal: mocks.goalBarAction,
  }),
}));

vi.mock("#product/lib/infra/measurement/measurement-port", () => ({
  logLatency: vi.fn(),
}));

vi.mock("#product/lib/access/anyharness/session-runtime", () => ({
  getSessionClientAndWorkspace: mocks.resolveSession,
}));

vi.mock("#product/stores/sessions/session-records", () => ({
  getSessionRecord: () => mocks.record,
  patchSessionRecord: mocks.patchSessionRecord,
}));

vi.mock("#product/stores/sessions/session-selection-store", () => ({
  useSessionSelectionStore: Object.assign(vi.fn(), {
    getState: () => mocks.selection,
  }),
}));

vi.mock("#product/stores/toast/toast-store", () => ({
  useToastStore: (selector: (state: { show: typeof mocks.showToast }) => unknown) =>
    selector({ show: mocks.showToast }),
}));

describe("useSessionCancelActions goal lifecycle", () => {
  beforeEach(() => {
    forgetSessionGoalIntent("runtime-1");
    mocks.cancel.mockReset().mockResolvedValue(undefined);
    mocks.clearGoal.mockReset().mockResolvedValue({ cleared: true });
    mocks.setGoal.mockReset().mockResolvedValue({
      goal: goalSnapshot("paused", "2026-07-17T12:00:02Z", 2),
    });
    mocks.patchSessionRecord.mockReset();
    mocks.showToast.mockReset();
    mocks.resolveSession.mockClear();
    mocks.goalBarAction.mockReset();
    mocks.selection.activeSessionId = "client-1";
    mocks.selection.selectedWorkspaceId = "workspace-1";
    mocks.record = sessionRecord("codex", "active");
  });

  afterEach(() => {
    cleanup();
    forgetSessionGoalIntent("runtime-1");
  });

  it("confirms native pause before cancelling and patching idle", async () => {
    const pause = deferred<{ goal: ReturnType<typeof goalSnapshot> }>();
    mocks.setGoal.mockReturnValueOnce(pause.promise);
    const { result } = renderHook(() => useSessionCancelActions());

    let cancellation!: Promise<void>;
    act(() => {
      cancellation = result.current.cancelActiveSession();
    });

    await waitFor(() => {
      expect(mocks.setGoal).toHaveBeenCalledWith({
        workspaceId: "workspace-1",
        sessionId: "runtime-1",
        request: { status: "paused" },
      });
    });
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.patchSessionRecord).not.toHaveBeenCalled();

    pause.resolve({ goal: goalSnapshot("paused", "2026-07-17T12:00:02Z", 2) });
    await act(async () => cancellation);

    expect(mocks.cancel).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      sessionId: "runtime-1",
    });
    expect(mocks.patchSessionRecord).toHaveBeenCalledWith("client-1", { status: "idle" });
  });

  it("keeps ordinary cancel behind create and fences the confirmed active intent", async () => {
    mocks.record = {
      ...sessionRecord("codex", "active"),
      activeGoal: null,
    };
    const create = deferred<{ goal: ReturnType<typeof goalSnapshot> }>();
    mocks.setGoal
      .mockReset()
      .mockReturnValueOnce(create.promise)
      .mockResolvedValueOnce({
        goal: goalSnapshot("paused", "2026-07-17T12:00:02Z", 2),
      });
    const { result } = renderHook(() => ({
      goal: useSessionGoalActions(null),
      session: useSessionCancelActions(),
    }));

    act(() => {
      result.current.goal.editGoal("Create then cancel");
    });
    let cancellation!: Promise<void>;
    act(() => {
      cancellation = result.current.session.cancelActiveSession();
    });

    await waitFor(() => expect(mocks.setGoal).toHaveBeenCalledTimes(1));
    expect(mocks.cancel).not.toHaveBeenCalled();

    create.resolve({
      goal: {
        ...goalSnapshot("active", "2026-07-17T12:00:01Z", 1),
        objective: "Create then cancel",
      },
    });
    await waitFor(() => expect(mocks.setGoal).toHaveBeenCalledTimes(2));
    expect(mocks.setGoal).toHaveBeenLastCalledWith({
      workspaceId: "workspace-1",
      sessionId: "runtime-1",
      request: { status: "paused" },
    });

    await act(async () => cancellation);
    expect(mocks.cancel).toHaveBeenCalledTimes(1);
  });

  it("keeps a later deliberate resume behind an earlier cancel", async () => {
    const lookup = deferred<{
      materializedSessionId: string;
      workspaceId: string;
    }>();
    mocks.resolveSession.mockReturnValueOnce(lookup.promise);
    mocks.setGoal
      .mockReset()
      .mockResolvedValueOnce({
        goal: goalSnapshot("paused", "2026-07-17T12:00:02Z", 2),
      })
      .mockResolvedValueOnce({
        goal: goalSnapshot("active", "2026-07-17T12:00:03Z", 3),
      });
    const { result } = renderHook(() => ({
      goal: useSessionGoalActions(null),
      session: useSessionCancelActions(),
    }));

    let cancellation!: Promise<void>;
    act(() => {
      cancellation = result.current.session.cancelActiveSession();
      result.current.goal.resumeGoal();
    });
    await Promise.resolve();
    expect(mocks.setGoal).not.toHaveBeenCalled();

    lookup.resolve({
      materializedSessionId: "runtime-1",
      workspaceId: "workspace-1",
    });
    await act(async () => cancellation);
    await waitFor(() => expect(mocks.setGoal).toHaveBeenCalledTimes(2));

    expect(mocks.setGoal.mock.calls.map(([input]) => input.request)).toEqual([
      { status: "paused" },
      { status: "active" },
    ]);
    expect(mocks.cancel).toHaveBeenCalledTimes(1);
  });

  it("keeps client click order across pending-to-materialized ID transition", async () => {
    const lookup = deferred<{
      materializedSessionId: string;
      workspaceId: string;
    }>();
    mocks.record = {
      ...sessionRecord("codex", "active"),
      activeGoal: null,
      materializedSessionId: null,
    };
    mocks.resolveSession.mockReturnValueOnce(lookup.promise);
    mocks.setGoal.mockReset().mockResolvedValue({
      goal: goalSnapshot("active", "2026-07-17T12:00:02Z", 1),
    });
    const { result } = renderHook(() => ({
      goal: useSessionGoalActions(null),
      session: useSessionCancelActions(),
    }));

    let cancellation!: Promise<void>;
    act(() => {
      cancellation = result.current.session.cancelActiveSession();
    });
    mocks.record = {
      ...mocks.record,
      materializedSessionId: "runtime-1",
    };
    act(() => {
      result.current.goal.editGoal("Deliberate later goal");
    });
    await Promise.resolve();
    expect(mocks.setGoal).not.toHaveBeenCalled();

    lookup.resolve({
      materializedSessionId: "runtime-1",
      workspaceId: "workspace-1",
    });
    await act(async () => cancellation);
    await waitFor(() => expect(mocks.setGoal).toHaveBeenCalledTimes(1));

    expect(mocks.cancel.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.setGoal.mock.invocationCallOrder[0]);
  });

  it("does not cancel after a stop failure and retries the full safe sequence", async () => {
    mocks.setGoal
      .mockRejectedValueOnce(new Error("native pause failed"))
      .mockResolvedValueOnce({
        goal: goalSnapshot("paused", "2026-07-17T12:00:02Z", 2),
      });
    const { result } = renderHook(() => useSessionCancelActions());

    await act(async () => result.current.cancelActiveSession());

    expect(mocks.setGoal).toHaveBeenCalledTimes(1);
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.patchSessionRecord).not.toHaveBeenCalled();
    expect(mocks.showToast).toHaveBeenCalledWith(
      "Could not confirm the goal stopped, so current work was not cancelled.",
    );

    await act(async () => result.current.cancelActiveSession());

    expect(mocks.setGoal).toHaveBeenCalledTimes(2);
    expect(mocks.cancel).toHaveBeenCalledTimes(1);
    expect(mocks.patchSessionRecord).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the pause response still reports an active goal", async () => {
    mocks.setGoal.mockResolvedValueOnce({
      goal: goalSnapshot("active", "2026-07-17T12:00:02Z", 2),
    });
    const { result } = renderHook(() => useSessionCancelActions());

    await act(async () => result.current.cancelActiveSession());

    expect(mocks.setGoal).toHaveBeenCalledTimes(1);
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.patchSessionRecord).not.toHaveBeenCalled();
  });

  it("retries cancellation without repeating a confirmed stop", async () => {
    mocks.cancel
      .mockRejectedValueOnce(new Error("cancel transport failed"))
      .mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useSessionCancelActions());

    await act(async () => result.current.cancelActiveSession());
    expect(mocks.setGoal).toHaveBeenCalledTimes(1);
    expect(mocks.cancel).toHaveBeenCalledTimes(1);
    expect(mocks.patchSessionRecord).not.toHaveBeenCalled();

    await act(async () => result.current.cancelActiveSession());

    expect(mocks.setGoal).toHaveBeenCalledTimes(1);
    expect(mocks.cancel).toHaveBeenCalledTimes(2);
    expect(mocks.patchSessionRecord).toHaveBeenCalledTimes(1);
  });

  it("fences a resumed goal even while the streamed mirror still reads paused", async () => {
    mocks.record = sessionRecord("codex", "paused");
    recordSessionGoalMutation(
      "runtime-1",
      goalSnapshot("active", "2026-07-17T12:00:02Z", 2),
    );
    const { result } = renderHook(() => useSessionCancelActions());

    await act(async () => result.current.cancelActiveSession());

    expect(mocks.setGoal).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      sessionId: "runtime-1",
      request: { status: "paused" },
    });
    expect(mocks.cancel).toHaveBeenCalledTimes(1);
  });

  it("uses confirmed clear when native pause is unavailable", async () => {
    mocks.record = sessionRecord("claude", "active");
    const clear = deferred<{ cleared: boolean }>();
    mocks.clearGoal.mockReturnValueOnce(clear.promise);
    const { result } = renderHook(() => useSessionCancelActions());

    let cancellation!: Promise<void>;
    act(() => {
      cancellation = result.current.cancelActiveSession();
    });

    await waitFor(() => expect(mocks.clearGoal).toHaveBeenCalledTimes(1));
    expect(mocks.cancel).not.toHaveBeenCalled();

    clear.resolve({ cleared: true });
    await act(async () => cancellation);

    expect(mocks.setGoal).not.toHaveBeenCalled();
    expect(mocks.cancel).toHaveBeenCalledTimes(1);
  });

  it("retries cancel directly after a confirmed clear", async () => {
    mocks.record = sessionRecord("claude", "active");
    mocks.cancel
      .mockRejectedValueOnce(new Error("cancel transport failed"))
      .mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useSessionCancelActions());

    await act(async () => result.current.cancelActiveSession());
    expect(mocks.clearGoal).toHaveBeenCalledTimes(1);
    expect(mocks.cancel).toHaveBeenCalledTimes(1);
    expect(mocks.patchSessionRecord).not.toHaveBeenCalled();

    // A lagging update from the same cleared goal lifetime must not erase the
    // confirmed stop before retry.
    mocks.record = {
      ...mocks.record,
      activeGoal: goalSnapshot("active", "2026-07-17T12:00:03Z", 3),
    };

    await act(async () => result.current.cancelActiveSession());

    expect(mocks.clearGoal).toHaveBeenCalledTimes(1);
    expect(mocks.cancel).toHaveBeenCalledTimes(2);
    expect(mocks.patchSessionRecord).toHaveBeenCalledTimes(1);
  });

  it("accepts an authoritative already-absent clear for a mirrored goal", async () => {
    mocks.record = sessionRecord("claude", "active");
    mocks.clearGoal.mockResolvedValueOnce({ cleared: false });
    const { result } = renderHook(() => useSessionCancelActions());

    await act(async () => result.current.cancelActiveSession());

    expect(mocks.clearGoal).toHaveBeenCalledTimes(1);
    expect(mocks.cancel).toHaveBeenCalledTimes(1);
    expect(mocks.patchSessionRecord).toHaveBeenCalledTimes(1);
  });

  it("fails closed when clear has not observed a newer UI goal mutation", async () => {
    mocks.record = sessionRecord("claude", "paused");
    recordSessionGoalMutation(
      "runtime-1",
      goalSnapshot("active", "2026-07-17T12:00:02Z", 2),
    );
    mocks.clearGoal.mockResolvedValueOnce({ cleared: false });
    const { result } = renderHook(() => useSessionCancelActions());

    await act(async () => result.current.cancelActiveSession());

    expect(mocks.clearGoal).toHaveBeenCalledTimes(1);
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.patchSessionRecord).not.toHaveBeenCalled();
  });
});

function sessionRecord(agentKind: string, goalStatus: "active" | "paused") {
  return {
    workspaceId: "workspace-1",
    materializedSessionId: "runtime-1",
    agentKind,
    actionCapabilities: { supportsGoals: true },
    activeGoal: goalSnapshot(goalStatus, "2026-07-17T12:00:01Z", 1),
  };
}

function goalSnapshot(
  status: "active" | "paused",
  updatedAt: string,
  revision: number,
) {
  return {
    createdAt: "2026-07-17T11:00:00Z",
    objective: "Finish safely",
    revision,
    status,
    updatedAt,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
