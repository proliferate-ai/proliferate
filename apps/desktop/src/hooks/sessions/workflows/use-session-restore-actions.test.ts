// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearReplacedSessionTombstone,
  commitReplacedSessionTombstone,
  isReplacedSessionTombstoned,
  resetReplacedSessionTombstonesForTests,
} from "@/hooks/sessions/workflows/session-replacement-tombstones";
import {
  resetSessionReplacementDismissalsForTests,
  runTrackedReplacementDismissal,
} from "@/hooks/sessions/workflows/session-replacement-dismissals";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useSessionRestoreActions } from "./use-session-restore-actions";

const mocks = vi.hoisted(() => ({
  getWorkspaceClientAndId: vi.fn(async () => ({
    target: {
      anyharnessWorkspaceId: "workspace-1",
      baseUrl: "http://runtime.test",
    },
  })),
  dismissMutateAsync: vi.fn(),
  restoreMutateAsync: vi.fn(),
  showToast: vi.fn(),
  upsertWorkspaceSessionRecord: vi.fn(),
  writeSessionReplacementTombstones: vi.fn(() => true),
}));

vi.mock("@/lib/access/browser/session-replacement-tombstones-storage", () => ({
  readSessionReplacementTombstones: () => ({}),
  writeSessionReplacementTombstones: mocks.writeSessionReplacementTombstones,
}));

vi.mock("@anyharness/sdk-react", () => ({
  useDismissSessionMutation: () => ({ mutateAsync: mocks.dismissMutateAsync }),
  useRestoreDismissedSessionMutation: () => ({ mutateAsync: mocks.restoreMutateAsync }),
}));

vi.mock("@/hooks/access/anyharness/sessions/use-workspace-session-cache", () => ({
  useWorkspaceSessionCache: () => ({
    upsertWorkspaceSessionRecord: mocks.upsertWorkspaceSessionRecord,
  }),
}));

vi.mock("@/hooks/workspaces/derived/use-workspace-runtime-block", () => ({
  useWorkspaceRuntimeBlock: () => ({
    getWorkspaceRuntimeBlockReason: () => null,
  }),
}));

vi.mock("@/hooks/sessions/workflows/session-selection-runtime", () => ({
  buildLatencyRequestOptions: () => undefined,
  ensureRuntimeReadyForSessions: async () => "http://runtime.test",
}));

vi.mock("@/lib/access/anyharness/session-runtime", () => ({
  getWorkspaceClientAndId: mocks.getWorkspaceClientAndId,
}));

vi.mock("@/stores/toast/toast-store", () => ({
  useToastStore: (selector: (state: { show: typeof mocks.showToast }) => unknown) =>
    selector({ show: mocks.showToast }),
}));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.writeSessionReplacementTombstones.mockReturnValue(true);
  resetReplacedSessionTombstonesForTests();
  resetSessionReplacementDismissalsForTests();
  useSessionSelectionStore.getState().clearSelection();
  useSessionSelectionStore.getState().activateWorkspace({
    logicalWorkspaceId: "logical-1",
    workspaceId: "workspace-1",
  });
});

afterEach(() => cleanup());

describe("useSessionRestoreActions", () => {
  it("does not restore when cleanup state cannot be persisted", async () => {
    mocks.writeSessionReplacementTombstones.mockReturnValue(false);
    const { result } = renderHook(() => useSessionRestoreActions());

    await act(async () => {
      await expect(result.current.restoreLastDismissedSession()).rejects.toThrow(
        "Could not save session cleanup state",
      );
    });

    expect(mocks.restoreMutateAsync).not.toHaveBeenCalled();
    expect(mocks.upsertWorkspaceSessionRecord).not.toHaveBeenCalled();
  });

  it("releases retired runtime and client aliases before cache upsert", async () => {
    commitReplacedSessionTombstone("workspace-1", "runtime-old", ["client-old"]);
    clearReplacedSessionTombstone("workspace-1", "runtime-old");
    expect(isReplacedSessionTombstoned("workspace-1", "runtime-old")).toBe(true);
    expect(isReplacedSessionTombstoned("workspace-1", "client-old")).toBe(true);
    const restored = { id: "runtime-old" };
    mocks.restoreMutateAsync.mockResolvedValue(restored);
    const { result } = renderHook(() => useSessionRestoreActions());

    let restoredId: string | null = null;
    await act(async () => {
      restoredId = await result.current.restoreLastDismissedSession();
    });

    expect(restoredId).toBe("runtime-old");
    expect(isReplacedSessionTombstoned("workspace-1", "runtime-old")).toBe(false);
    expect(isReplacedSessionTombstoned("workspace-1", "client-old")).toBe(false);
    expect(mocks.upsertWorkspaceSessionRecord).toHaveBeenCalledWith(
      "workspace-1",
      restored,
    );
  });

  it("waits for an in-flight replacement dismissal before restoring", async () => {
    const dismissalStarted = deferred();
    const dismissalGate = deferred();
    const order: string[] = [];
    void runTrackedReplacementDismissal({
      workspaceId: "workspace-1",
      runtimeSessionId: "runtime-old",
      run: async () => {
        order.push("dismiss:start");
        dismissalStarted.resolve();
        await dismissalGate.promise;
        order.push("dismiss:end");
      },
    });
    await dismissalStarted.promise;

    const restored = { id: "runtime-old" };
    mocks.restoreMutateAsync.mockImplementation(async () => {
      order.push("restore");
      return restored;
    });
    const { result } = renderHook(() => useSessionRestoreActions());

    let restorePromise!: Promise<string | null>;
    act(() => {
      restorePromise = result.current.restoreLastDismissedSession();
    });
    await vi.waitFor(() => {
      expect(mocks.getWorkspaceClientAndId).toHaveBeenCalledTimes(1);
    });
    expect(mocks.restoreMutateAsync).not.toHaveBeenCalled();
    expect(order).toEqual(["dismiss:start"]);

    dismissalGate.resolve();
    await act(async () => {
      await expect(restorePromise).resolves.toBe("runtime-old");
    });

    expect(order).toEqual(["dismiss:start", "dismiss:end", "restore"]);
    expect(mocks.upsertWorkspaceSessionRecord).toHaveBeenCalledWith(
      "workspace-1",
      restored,
    );
  });

  it("cancels queued cleanup only for the runtime returned by restore", async () => {
    const restored = { id: "runtime-restored" };
    const dismissRestored = vi.fn();
    const dismissUnrelated = vi.fn();
    let restoredCleanup!: Promise<void>;
    let unrelatedCleanup!: Promise<void>;
    mocks.restoreMutateAsync.mockImplementation(async () => {
      restoredCleanup = runTrackedReplacementDismissal({
        workspaceId: "workspace-1",
        runtimeSessionId: "runtime-restored",
        run: dismissRestored,
      });
      unrelatedCleanup = runTrackedReplacementDismissal({
        workspaceId: "workspace-1",
        runtimeSessionId: "runtime-unrelated",
        run: dismissUnrelated,
      });
      return restored;
    });
    const { result } = renderHook(() => useSessionRestoreActions());

    let restoredId: string | null = null;
    await act(async () => {
      restoredId = await result.current.restoreLastDismissedSession();
    });
    await Promise.all([restoredCleanup, unrelatedCleanup]);

    expect(restoredId).toBe("runtime-restored");
    expect(dismissRestored).not.toHaveBeenCalled();
    expect(dismissUnrelated).toHaveBeenCalledTimes(1);
  });
});
