// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { GoalWire } from "@proliferate/product-domain/activity/goal";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  activeSessionId: "client-session-0",
  materializedSessionId: "runtime-session-0",
  workspaceId: "workspace-0",
  setGoal: vi.fn(),
  clearGoal: vi.fn(),
  cancelSession: vi.fn(),
  patchSessionRecord: vi.fn(),
  beginComposing: vi.fn(),
  endComposing: vi.fn(),
  dismissResult: vi.fn(),
  setPendingGoal: vi.fn(),
  clearPendingGoal: vi.fn(),
  showToast: vi.fn(),
  logLatency: vi.fn(),
  activeGoal: null as ReturnType<typeof goalSnapshot> | null,
}));

vi.mock("@anyharness/sdk-react", () => ({
  useSetSessionGoalMutation: () => ({
    mutateAsync: mocks.setGoal,
    isPending: false,
  }),
  useClearSessionGoalMutation: () => ({
    mutateAsync: mocks.clearGoal,
    isPending: false,
  }),
  useCancelSessionMutation: () => ({
    mutateAsync: mocks.cancelSession,
    isPending: false,
  }),
}));

vi.mock("#product/hooks/chat/derived/use-active-session-identity", () => ({
  useActiveSessionId: () => mocks.activeSessionId,
}));

vi.mock("#product/stores/sessions/session-records", () => ({
  getSessionRecord: () => ({
    materializedSessionId: mocks.materializedSessionId,
    workspaceId: mocks.workspaceId,
    activeGoal: mocks.activeGoal,
  }),
  patchSessionRecord: mocks.patchSessionRecord,
}));

vi.mock("#product/stores/activity/goal-bar-store", () => ({
  goalResultDismissKey: (status: string, updatedAtMs: number) => `${status}:${updatedAtMs}`,
  useGoalBarStore: (
    selector: (state: Record<string, unknown>) => unknown,
  ) => selector({
    beginComposing: mocks.beginComposing,
    endComposing: mocks.endComposing,
    dismissResult: mocks.dismissResult,
    setPendingGoal: mocks.setPendingGoal,
    clearPendingGoal: mocks.clearPendingGoal,
  }),
}));

vi.mock("#product/stores/toast/toast-store", () => ({
  useToastStore: (
    selector: (state: Record<string, unknown>) => unknown,
  ) => selector({ show: mocks.showToast }),
}));

vi.mock("#product/lib/infra/measurement/measurement-port", () => ({
  logLatency: mocks.logLatency,
}));

import { useSessionGoalActions } from "./use-session-goal-actions";

function goal(status: "active" | "paused"): GoalWire {
  return {
    objective: "Existing objective",
    status,
    nativeStatus: status,
    tokenBudget: 12_345,
    tokensUsed: 123,
    timeUsedSeconds: 45,
    metReason: null,
    iterations: null,
    native: true,
    updatedAtMs: 1_000,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("useSessionGoalActions", () => {
  let testSequence = 0;

  beforeEach(() => {
    vi.clearAllMocks();
    testSequence += 1;
    mocks.activeSessionId = `client-session-${testSequence}`;
    mocks.materializedSessionId = `runtime-session-${testSequence}`;
    mocks.workspaceId = `workspace-${testSequence}`;
    mocks.activeGoal = null;
    mocks.setGoal.mockResolvedValue({
      goal: goalSnapshot("active", "2026-07-17T12:00:02Z", 2),
    });
    mocks.clearGoal.mockResolvedValue({ cleared: true });
    mocks.cancelSession.mockResolvedValue({});
  });

  afterEach(cleanup);

  it("trims a fresh objective and applies the finite UI default budget", async () => {
    const { result } = renderHook(() => useSessionGoalActions(null));

    act(() => {
      result.current.editGoal("  Ship the lifecycle repair  ");
    });

    await waitFor(() => {
      expect(mocks.setGoal).toHaveBeenCalledWith({
        sessionId: mocks.materializedSessionId,
        workspaceId: mocks.workspaceId,
        request: {
          objective: "Ship the lifecycle repair",
          tokenBudget: 50_000,
        },
      });
    });
  });

  it("confirms pause before cancelling and waits for cancellation before patching idle", async () => {
    mocks.activeGoal = goalSnapshot("active", "2026-07-17T12:00:01Z", 1);
    const pause = deferred<{ goal: ReturnType<typeof goalSnapshot> }>();
    const cancel = deferred<unknown>();
    mocks.setGoal.mockReturnValueOnce(pause.promise);
    mocks.cancelSession.mockReturnValueOnce(cancel.promise);
    const { result } = renderHook(() => useSessionGoalActions(goal("active")));

    act(() => {
      result.current.pauseGoal();
    });

    await waitFor(() => {
      expect(mocks.setGoal).toHaveBeenCalledWith({
        sessionId: mocks.materializedSessionId,
        workspaceId: mocks.workspaceId,
        request: { status: "paused" },
      });
    });
    expect(mocks.cancelSession).not.toHaveBeenCalled();
    expect(mocks.patchSessionRecord).not.toHaveBeenCalled();

    await act(async () => {
      pause.resolve({
        goal: goalSnapshot("paused", "2026-07-17T12:00:02Z", 2),
      });
      await pause.promise;
    });

    await waitFor(() => {
      expect(mocks.cancelSession).toHaveBeenCalledWith({
        sessionId: mocks.materializedSessionId,
        workspaceId: mocks.workspaceId,
      });
    });
    expect(mocks.patchSessionRecord).not.toHaveBeenCalled();

    await act(async () => {
      cancel.resolve({});
      await cancel.promise;
    });

    await waitFor(() => {
      expect(mocks.patchSessionRecord).toHaveBeenCalledWith(
        mocks.activeSessionId,
        { status: "idle" },
      );
    });
  });

  it("resumes with only the active arm-state request and does not cancel", async () => {
    mocks.activeGoal = goalSnapshot("paused", "2026-07-17T12:00:01Z", 1);
    const { result } = renderHook(() => useSessionGoalActions(goal("paused")));

    act(() => {
      result.current.resumeGoal();
    });

    await waitFor(() => {
      expect(mocks.setGoal).toHaveBeenCalledTimes(1);
    });
    expect(mocks.setGoal).toHaveBeenCalledWith({
      sessionId: mocks.materializedSessionId,
      workspaceId: mocks.workspaceId,
      request: { status: "active" },
    });
    expect(mocks.cancelSession).not.toHaveBeenCalled();
  });

  it("waits for a confirmed clear before cancelling", async () => {
    mocks.activeGoal = goalSnapshot("active", "2026-07-17T12:00:01Z", 1);
    const clear = deferred<{ cleared: boolean }>();
    mocks.clearGoal.mockReturnValueOnce(clear.promise);
    const { result } = renderHook(() => useSessionGoalActions(goal("active")));

    act(() => {
      result.current.clearGoal();
    });

    await waitFor(() => {
      expect(mocks.clearGoal).toHaveBeenCalledWith({
        sessionId: mocks.materializedSessionId,
        workspaceId: mocks.workspaceId,
      });
    });
    expect(mocks.cancelSession).not.toHaveBeenCalled();

    await act(async () => {
      clear.resolve({ cleared: true });
      await clear.promise;
    });

    await waitFor(() => {
      expect(mocks.cancelSession).toHaveBeenCalledWith({
        sessionId: mocks.materializedSessionId,
        workspaceId: mocks.workspaceId,
      });
    });
  });

  it("cancels when a mirrored goal is already authoritatively absent", async () => {
    mocks.activeGoal = goalSnapshot("active", "2026-07-17T12:00:01Z", 1);
    mocks.clearGoal.mockResolvedValueOnce({ cleared: false });
    const { result } = renderHook(() => useSessionGoalActions(goal("active")));

    act(() => {
      result.current.clearGoal();
    });

    await waitFor(() => expect(mocks.cancelSession).toHaveBeenCalledTimes(1));
    expect(mocks.showToast).not.toHaveBeenCalled();
  });

  it("does not cancel when clear has not observed a just-created goal", async () => {
    mocks.clearGoal.mockResolvedValueOnce({ cleared: false });
    const { result } = renderHook(() => useSessionGoalActions(null));

    act(() => {
      result.current.editGoal("Create then clear");
    });
    await waitFor(() => expect(mocks.setGoal).toHaveBeenCalledTimes(1));

    act(() => {
      result.current.clearGoal();
    });

    await waitFor(() => expect(mocks.clearGoal).toHaveBeenCalledTimes(1));
    expect(mocks.cancelSession).not.toHaveBeenCalled();
  });

  it("applies the fresh default when create follows clear before the mirror catches up", async () => {
    mocks.activeGoal = goalSnapshot("active", "2026-07-17T12:00:01Z", 1);
    const { result } = renderHook(() => useSessionGoalActions(goal("active")));

    act(() => {
      result.current.clearGoal();
    });
    await waitFor(() => expect(mocks.cancelSession).toHaveBeenCalledTimes(1));
    mocks.setGoal.mockClear();

    act(() => {
      result.current.editGoal("Replacement goal");
    });

    await waitFor(() => {
      expect(mocks.setGoal).toHaveBeenCalledWith({
        sessionId: mocks.materializedSessionId,
        workspaceId: mocks.workspaceId,
        request: {
          objective: "Replacement goal",
          tokenBudget: 50_000,
        },
      });
    });
  });

  it("does not cancel when a pause response still reports active", async () => {
    mocks.activeGoal = goalSnapshot("active", "2026-07-17T12:00:01Z", 1);
    mocks.setGoal.mockResolvedValueOnce({
      goal: goalSnapshot("active", "2026-07-17T12:00:02Z", 2),
    });
    const { result } = renderHook(() => useSessionGoalActions(goal("active")));

    act(() => {
      result.current.pauseGoal();
    });

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledTimes(1));
    expect(mocks.cancelSession).not.toHaveBeenCalled();
  });
});

function goalSnapshot(
  status: "active" | "paused",
  updatedAt: string,
  revision: number,
) {
  return {
    createdAt: "2026-07-17T11:00:00Z",
    objective: "Existing objective",
    revision,
    status,
    updatedAt,
  };
}
