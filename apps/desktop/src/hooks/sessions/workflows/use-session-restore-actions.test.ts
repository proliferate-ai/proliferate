// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearReplacedSessionTombstone,
  commitReplacedSessionTombstone,
  prepareSessionReplacementTombstonesForStorage,
  resetReplacedSessionTombstonesForTests,
} from "@/hooks/sessions/workflows/session-replacement-tombstone-durable-operations";
import {
  beginSessionReplacementTombstoneHydration,
  settleSessionReplacementTombstoneHydration,
} from "@/hooks/sessions/workflows/session-replacement-tombstone-authority";
import {
  isReplacedSessionTombstoned,
} from "@/hooks/sessions/workflows/session-replacement-tombstones";
import {
  resetSessionReplacementDismissalsForTests,
  runTrackedReplacementDismissal,
} from "@/hooks/sessions/workflows/session-replacement-dismissals";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useSessionRestoreActions } from "./use-session-restore-actions";

const mocks = vi.hoisted(() => ({
  cloudClient: {},
  localRuntime: {},
  getWorkspaceClientAndId: vi.fn(async () => ({
    target: {
      anyharnessWorkspaceId: "workspace-1",
      baseUrl: "http://runtime.test",
    },
  })),
  dismissMutateAsync: vi.fn(),
  restoreMutateAsync: vi.fn(),
  resolveRuntimeUrlForWorkspaceSessions: vi.fn(async () => "http://runtime.test"),
  showToast: vi.fn(),
  upsertWorkspaceSessionRecord: vi.fn(),
  storage: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
  },
  captureException: vi.fn(),
}));

const persistence = {
  storage: mocks.storage,
  captureException: mocks.captureException,
};

vi.mock("@proliferate/product-client/host/ProductHostProvider", () => ({
  useProductHost: () => ({
    cloud: { client: mocks.cloudClient },
    desktop: { runtime: mocks.localRuntime },
    storage: mocks.storage,
    telemetry: { captureException: mocks.captureException },
  }),
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
  resolveRuntimeUrlForWorkspaceSessions: mocks.resolveRuntimeUrlForWorkspaceSessions,
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
  resetReplacedSessionTombstonesForTests();
  beginSessionReplacementTombstoneHydration(mocks.storage);
  prepareSessionReplacementTombstonesForStorage(mocks.storage);
  settleSessionReplacementTombstoneHydration(false);
  resetSessionReplacementDismissalsForTests();
  useSessionSelectionStore.getState().clearSelection();
  useSessionSelectionStore.getState().activateWorkspace({
    logicalWorkspaceId: "logical-1",
    workspaceId: "workspace-1",
  });
});

afterEach(() => cleanup());

describe("useSessionRestoreActions", () => {
  it("releases retired runtime and client aliases before cache upsert", async () => {
    await commitReplacedSessionTombstone(
      persistence,
      "workspace-1",
      "runtime-old",
      ["client-old"],
    );
    await clearReplacedSessionTombstone(persistence, "workspace-1", "runtime-old");
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
    expect(mocks.resolveRuntimeUrlForWorkspaceSessions).toHaveBeenCalledWith(
      "workspace-1",
      mocks.localRuntime,
    );
    expect(mocks.getWorkspaceClientAndId).toHaveBeenCalledWith(
      "http://runtime.test",
      "workspace-1",
      null,
      mocks.cloudClient,
    );
    expect(isReplacedSessionTombstoned("workspace-1", "runtime-old")).toBe(false);
    expect(isReplacedSessionTombstoned("workspace-1", "client-old")).toBe(false);
    expect(mocks.upsertWorkspaceSessionRecord).toHaveBeenCalledWith(
      "workspace-1",
      restored,
    );
  });

  it("re-dismisses a restored runtime when durable tombstone removal fails", async () => {
    await commitReplacedSessionTombstone(persistence, "workspace-1", "runtime-old");
    mocks.storage.removeItem.mockRejectedValueOnce(new Error("write failed"));
    mocks.restoreMutateAsync.mockResolvedValue({ id: "runtime-old" });
    mocks.dismissMutateAsync.mockResolvedValue(undefined);
    const { result } = renderHook(() => useSessionRestoreActions());

    await act(async () => {
      await expect(result.current.restoreLastDismissedSession()).rejects.toThrow(
        "Could not save restored session state",
      );
    });

    expect(mocks.dismissMutateAsync).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      sessionId: "runtime-old",
    });
    expect(isReplacedSessionTombstoned("workspace-1", "runtime-old")).toBe(true);
    expect(mocks.upsertWorkspaceSessionRecord).not.toHaveBeenCalled();
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
