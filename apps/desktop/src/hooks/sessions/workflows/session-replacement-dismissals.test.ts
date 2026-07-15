import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelQueuedReplacementDismissal,
  resetSessionReplacementDismissalsForTests,
  runTrackedReplacementDismissal,
  withWorkspaceReplacementRestoreFence,
} from "@/hooks/sessions/workflows/session-replacement-dismissals";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  resetSessionReplacementDismissalsForTests();
});

describe("replacement session dismissal coordination", () => {
  it("publishes and deduplicates a dismissal before its async body begins", async () => {
    const cleanupGate = deferred();
    const nestedCleanup = vi.fn();
    let nestedDismissal: Promise<void> | null = null;
    const cleanup = vi.fn(async () => {
      nestedDismissal = runTrackedReplacementDismissal({
        workspaceId: "workspace-1",
        runtimeSessionId: "runtime-1",
        run: nestedCleanup,
      });
      await cleanupGate.promise;
    });

    const first = runTrackedReplacementDismissal({
      workspaceId: "workspace-1",
      runtimeSessionId: "runtime-1",
      run: cleanup,
    });
    const duplicate = runTrackedReplacementDismissal({
      workspaceId: "workspace-1",
      runtimeSessionId: "runtime-1",
      run: nestedCleanup,
    });

    expect(duplicate).toBe(first);
    await Promise.resolve();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(nestedCleanup).not.toHaveBeenCalled();

    cleanupGate.resolve();
    await first;
    await nestedDismissal;
    expect(nestedCleanup).not.toHaveBeenCalled();
  });

  it("waits for existing cleanup and drains deduplicated queued cleanup after restore", async () => {
    const cleanupStarted = deferred();
    const cleanupGate = deferred();
    const cleanup = runTrackedReplacementDismissal({
      workspaceId: "workspace-1",
      runtimeSessionId: "runtime-old",
      run: async () => {
        cleanupStarted.resolve();
        await cleanupGate.promise;
      },
    });
    await cleanupStarted.promise;

    const restoreGate = deferred();
    const restoreStarted = deferred();
    const restoreFn = vi.fn(async () => {
      restoreStarted.resolve();
      await restoreGate.promise;
      return "restored";
    });
    const restore = withWorkspaceReplacementRestoreFence(
      "workspace-1",
      restoreFn,
    );
    const cleanupDuringRestore = vi.fn();
    const queuedCleanup = runTrackedReplacementDismissal({
      workspaceId: "workspace-1",
      runtimeSessionId: "runtime-another",
      run: cleanupDuringRestore,
    });
    const duplicateQueuedCleanup = runTrackedReplacementDismissal({
      workspaceId: "workspace-1",
      runtimeSessionId: "runtime-another",
      run: vi.fn(),
    });

    expect(duplicateQueuedCleanup).toBe(queuedCleanup);
    expect(restoreFn).not.toHaveBeenCalled();
    expect(cleanupDuringRestore).not.toHaveBeenCalled();

    cleanupGate.resolve();
    await cleanup;
    await restoreStarted.promise;
    expect(restoreFn).toHaveBeenCalledTimes(1);
    expect(cleanupDuringRestore).not.toHaveBeenCalled();

    restoreGate.resolve();
    await expect(restore).resolves.toBe("restored");
    await queuedCleanup;
    expect(cleanupDuringRestore).toHaveBeenCalledTimes(1);
  });

  it("cancels only the restored runtime's queued cleanup", async () => {
    const restoreGate = deferred();
    const restoredCleanup = vi.fn();
    const unrelatedCleanup = vi.fn();
    const restore = withWorkspaceReplacementRestoreFence(
      "workspace-1",
      async () => {
        await restoreGate.promise;
        expect(cancelQueuedReplacementDismissal(
          "workspace-1",
          "runtime-restored",
        )).toBe(true);
        expect(cancelQueuedReplacementDismissal(
          "workspace-1",
          "runtime-missing",
        )).toBe(false);
      },
    );
    const canceledCleanup = runTrackedReplacementDismissal({
      workspaceId: "workspace-1",
      runtimeSessionId: "runtime-restored",
      run: restoredCleanup,
    });
    const drainedCleanup = runTrackedReplacementDismissal({
      workspaceId: "workspace-1",
      runtimeSessionId: "runtime-unrelated",
      run: unrelatedCleanup,
    });

    expect(restoredCleanup).not.toHaveBeenCalled();
    expect(unrelatedCleanup).not.toHaveBeenCalled();

    restoreGate.resolve();
    await restore;
    await Promise.all([canceledCleanup, drainedCleanup]);
    expect(restoredCleanup).not.toHaveBeenCalled();
    expect(unrelatedCleanup).toHaveBeenCalledTimes(1);
  });

  it("serializes concurrent restores and drains only after every fence closes", async () => {
    const firstGate = deferred();
    const firstStarted = deferred();
    const secondGate = deferred();
    const secondStarted = deferred();
    const order: string[] = [];
    const first = withWorkspaceReplacementRestoreFence(
      "workspace-1",
      async () => {
        order.push("first:start");
        firstStarted.resolve();
        await firstGate.promise;
        order.push("first:end");
      },
    );
    const second = withWorkspaceReplacementRestoreFence(
      "workspace-1",
      async () => {
        order.push("second:start");
        secondStarted.resolve();
        await secondGate.promise;
        order.push("second:end");
      },
    );
    const queuedCleanupFn = vi.fn();
    const queuedCleanup = runTrackedReplacementDismissal({
      workspaceId: "workspace-1",
      runtimeSessionId: "runtime-queued",
      run: queuedCleanupFn,
    });

    await firstStarted.promise;
    expect(order).toEqual(["first:start"]);

    firstGate.resolve();
    await first;
    await secondStarted.promise;
    expect(order).toEqual(["first:start", "first:end", "second:start"]);
    expect(queuedCleanupFn).not.toHaveBeenCalled();

    secondGate.resolve();
    await second;
    await queuedCleanup;
    expect(order).toEqual([
      "first:start",
      "first:end",
      "second:start",
      "second:end",
    ]);
    expect(queuedCleanupFn).toHaveBeenCalledTimes(1);
  });

  it("drains queued cleanup when restore returns no session", async () => {
    const restoreGate = deferred();
    const restore = withWorkspaceReplacementRestoreFence(
      "workspace-1",
      async () => {
        await restoreGate.promise;
        return null;
      },
    );
    const cleanupFn = vi.fn();
    const cleanup = runTrackedReplacementDismissal({
      workspaceId: "workspace-1",
      runtimeSessionId: "runtime-1",
      run: cleanupFn,
    });

    restoreGate.resolve();
    await expect(restore).resolves.toBeNull();
    await cleanup;
    expect(cleanupFn).toHaveBeenCalledTimes(1);
  });

  it("drains queued cleanup and clears the fence when restore fails", async () => {
    const restoreError = new Error("restore failed");
    const restoreGate = deferred();
    const restore = withWorkspaceReplacementRestoreFence(
      "workspace-1",
      async () => {
        await restoreGate.promise;
        throw restoreError;
      },
    );
    const queuedCleanupFn = vi.fn();
    const queuedCleanup = runTrackedReplacementDismissal({
      workspaceId: "workspace-1",
      runtimeSessionId: "runtime-1",
      run: queuedCleanupFn,
    });
    expect(queuedCleanupFn).not.toHaveBeenCalled();

    restoreGate.resolve();
    await expect(restore).rejects.toBe(restoreError);
    await queuedCleanup;
    expect(queuedCleanupFn).toHaveBeenCalledTimes(1);

    const cleanupAfterFailure = vi.fn();
    await runTrackedReplacementDismissal({
      workspaceId: "workspace-1",
      runtimeSessionId: "runtime-2",
      run: cleanupAfterFailure,
    });
    expect(cleanupAfterFailure).toHaveBeenCalledTimes(1);
  });
});
