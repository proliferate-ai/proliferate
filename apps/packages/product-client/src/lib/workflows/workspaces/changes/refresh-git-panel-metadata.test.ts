import { describe, expect, it, vi } from "vitest";
import { refreshGitPanelMetadata } from "./refresh-git-panel-metadata";

describe("refreshGitPanelMetadata", () => {
  it("advances the force epoch only after every metadata refresh succeeds", async () => {
    const first = deferred<{ isError: boolean }>();
    const second = deferred<{ isError: boolean }>();
    const advanceForceEpoch = vi.fn(() => 1);
    const refresh = refreshGitPanelMetadata({
      refreshes: [() => first.promise, () => second.promise],
      advanceForceEpoch,
    });

    first.resolve({ isError: false });
    await Promise.resolve();
    expect(advanceForceEpoch).not.toHaveBeenCalled();
    second.resolve({ isError: false });

    await expect(refresh).resolves.toBe(true);
    expect(advanceForceEpoch).toHaveBeenCalledTimes(1);
  });

  it("retains the prior epoch when any metadata refresh fails", async () => {
    const advanceForceEpoch = vi.fn(() => 1);
    await expect(refreshGitPanelMetadata({
      refreshes: [
        async () => ({ isError: false }),
        async () => ({ isError: true }),
      ],
      advanceForceEpoch,
    })).resolves.toBe(false);
    expect(advanceForceEpoch).not.toHaveBeenCalled();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
