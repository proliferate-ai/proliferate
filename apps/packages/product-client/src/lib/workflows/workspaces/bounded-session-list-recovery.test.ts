import { describe, expect, it, vi } from "vitest";
import {
  loadSessionsWithBoundedRecovery,
} from "#product/lib/workflows/workspaces/bounded-session-list-recovery";

describe("loadSessionsWithBoundedRecovery", () => {
  it("uses the first authoritative session list when it succeeds", async () => {
    const load = vi.fn().mockResolvedValue([{ id: "session-1" }]);

    await expect(loadSessionsWithBoundedRecovery({
      isCurrent: () => true,
      load,
    })).resolves.toEqual({
      kind: "loaded",
      sessions: [{ id: "session-1" }],
      recovered: false,
    });
    expect(load).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledWith(false);
  });

  it("forces the first read when recovery must bypass a stale non-empty cache", async () => {
    const load = vi.fn(async (force: boolean) => (
      force ? [{ id: "new" }] : [{ id: "gone" }]
    ));

    await expect(loadSessionsWithBoundedRecovery({
      forceInitialRefresh: true,
      isCurrent: () => true,
      load,
    })).resolves.toEqual({
      kind: "loaded",
      sessions: [{ id: "new" }],
      recovered: false,
    });
    expect(load.mock.calls).toEqual([[true]]);
  });

  it("rejects a non-empty first forced result after ownership changes", async () => {
    let current = true;
    const load = vi.fn(async () => {
      current = false;
      return [{ id: "stale" }];
    });

    await expect(loadSessionsWithBoundedRecovery({
      forceInitialRefresh: true,
      isCurrent: () => current,
      load,
    })).resolves.toEqual({ kind: "stale" });
    expect(load.mock.calls).toEqual([[true]]);
  });

  it("never reuses a stale non-empty cache when the authoritative retry is empty", async () => {
    const load = vi.fn(async (force: boolean) => (
      force ? [] : [{ id: "gone" }]
    ));

    await expect(loadSessionsWithBoundedRecovery({
      forceInitialRefresh: true,
      isCurrent: () => true,
      load,
    })).resolves.toEqual({
      kind: "loaded",
      sessions: [],
      recovered: true,
    });
    expect(load.mock.calls).toEqual([[true], [true]]);
  });

  it("runs exactly one forced retry after a transient lookup failure", async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(new Error("directory delayed"))
      .mockResolvedValueOnce([{ id: "session-2" }]);

    await expect(loadSessionsWithBoundedRecovery({
      isCurrent: () => true,
      load,
    })).resolves.toEqual({
      kind: "loaded",
      sessions: [{ id: "session-2" }],
      recovered: true,
    });
    expect(load.mock.calls).toEqual([[false], [true]]);
  });

  it("forces one authoritative read before treating an empty cache as an empty workspace", async () => {
    const load = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "session-delayed" }]);

    await expect(loadSessionsWithBoundedRecovery({
      isCurrent: () => true,
      load,
    })).resolves.toEqual({
      kind: "loaded",
      sessions: [{ id: "session-delayed" }],
      recovered: true,
    });
    expect(load.mock.calls).toEqual([[false], [true]]);
  });

  it("stops after the bounded retry instead of looping", async () => {
    const load = vi.fn().mockRejectedValue(new Error("runtime unavailable"));

    await expect(loadSessionsWithBoundedRecovery({
      isCurrent: () => true,
      load,
    })).resolves.toEqual({ kind: "failed" });
    expect(load.mock.calls).toEqual([[false], [true]]);
  });

  it("does not recover a selection that became stale", async () => {
    let current = true;
    const load = vi.fn().mockImplementation(async () => {
      current = false;
      throw new Error("selection changed");
    });

    await expect(loadSessionsWithBoundedRecovery({
      isCurrent: () => current,
      load,
    })).resolves.toEqual({ kind: "stale" });
    expect(load).toHaveBeenCalledOnce();
  });

  it("ignores a forced result that completes after the selection becomes stale", async () => {
    let current = true;
    const load = vi.fn()
      .mockResolvedValueOnce([])
      .mockImplementationOnce(async () => {
        current = false;
        return [{ id: "stale-session" }];
      });

    await expect(loadSessionsWithBoundedRecovery({
      isCurrent: () => current,
      load,
    })).resolves.toEqual({ kind: "stale" });
    expect(load.mock.calls).toEqual([[false], [true]]);
  });
});
