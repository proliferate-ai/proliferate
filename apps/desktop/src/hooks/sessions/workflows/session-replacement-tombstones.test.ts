import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearReplacedSessionTombstone,
  commitReplacedSessionTombstone,
  committedReplacedSessionTombstonesForWorkspace,
  prepareSessionReplacementTombstonesForStorage,
  releaseReplacedSessionSuppression,
  resetReplacedSessionTombstonesForTests,
} from "@/hooks/sessions/workflows/session-replacement-tombstone-durable-operations";
import {
  beginSessionReplacementTombstoneHydration,
  settleSessionReplacementTombstoneHydration,
} from "@/hooks/sessions/workflows/session-replacement-tombstone-authority";
import {
  clearStagedReplacedClientSessionAlias,
  clearStagedReplacedSessionTombstone,
  filterReplacedSessionTombstones,
  filterReplacedSessionIds,
  isReplacedSessionTombstoned,
  isReplacedSessionTombstonedInAnyWorkspace,
  retireStagedReplacedClientSessionAlias,
  shouldPreserveStagedReplacementShell,
  stageReplacedClientSessionAlias,
  stageReplacedSessionTombstone,
} from "@/hooks/sessions/workflows/session-replacement-tombstones";

const storage = {
  getItem: vi.fn(async () => null),
  setItem: vi.fn<(
    key: string,
    value: string,
  ) => Promise<void>>(async () => undefined),
  removeItem: vi.fn<(key: string) => Promise<void>>(async () => undefined),
};
const persistence = { storage, captureException: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  resetReplacedSessionTombstonesForTests();
  beginSessionReplacementTombstoneHydration(storage);
  prepareSessionReplacementTombstonesForStorage(storage);
  settleSessionReplacementTombstoneHydration(false);
});

describe("replacement session tombstones", () => {
  it("suppresses a client-only replacement without making it dismissible", async () => {
    stageReplacedClientSessionAlias("workspace-1", "client-old");

    expect(isReplacedSessionTombstoned("workspace-1", "client-old")).toBe(true);
    expect(filterReplacedSessionIds("workspace-1", ["client-old", "client-new"]))
      .toEqual(["client-new"]);
    expect(committedReplacedSessionTombstonesForWorkspace("workspace-1"))
      .toEqual([]);
    expect(shouldPreserveStagedReplacementShell("workspace-1", "workspace-1"))
      .toBe(true);

    retireStagedReplacedClientSessionAlias("workspace-1", "client-old");
    expect(shouldPreserveStagedReplacementShell("workspace-1", "workspace-1"))
      .toBe(false);
    expect(isReplacedSessionTombstoned("workspace-1", "client-old")).toBe(true);

    clearStagedReplacedClientSessionAlias("workspace-1", "client-old");
    expect(isReplacedSessionTombstoned("workspace-1", "client-old")).toBe(true);
    await releaseReplacedSessionSuppression(
      persistence,
      "workspace-1",
      "client-old",
    );
    expect(isReplacedSessionTombstoned("workspace-1", "client-old")).toBe(false);
  });

  it("stages aliases for suppression without making the runtime dismissible", () => {
    stageReplacedSessionTombstone(
      "workspace-1",
      "runtime-old",
      ["client-old"],
    );

    expect(isReplacedSessionTombstoned("workspace-1", "runtime-old")).toBe(true);
    expect(isReplacedSessionTombstoned("workspace-1", "client-old")).toBe(true);
    expect(isReplacedSessionTombstonedInAnyWorkspace("runtime-old")).toBe(true);
    expect(committedReplacedSessionTombstonesForWorkspace("workspace-1")).toEqual([]);
    expect(shouldPreserveStagedReplacementShell("workspace-1", "workspace-1"))
      .toBe(true);
    expect(shouldPreserveStagedReplacementShell("workspace-1", "workspace-2"))
      .toBe(false);
    expect(filterReplacedSessionTombstones("workspace-1", [
      { id: "runtime-old" },
      { id: "runtime-new" },
    ])).toEqual([{ id: "runtime-new" }]);
    expect(filterReplacedSessionIds("workspace-1", ["client-old", "client-new"]))
      .toEqual(["client-new"]);
    expect(filterReplacedSessionTombstones("workspace-2", [
      { id: "runtime-old" },
    ])).toEqual([{ id: "runtime-old" }]);

    clearStagedReplacedSessionTombstone("workspace-1", "runtime-old");
    expect(shouldPreserveStagedReplacementShell("workspace-1", "workspace-1"))
      .toBe(false);
    expect(isReplacedSessionTombstoned("workspace-1", "runtime-old")).toBe(false);
    expect(isReplacedSessionTombstonedInAnyWorkspace("runtime-old")).toBe(false);
  });

  it("commits the runtime id and aliases until authoritative cleanup", async () => {
    stageReplacedSessionTombstone("workspace-1", "runtime-old", ["client-old"]);
    await commitReplacedSessionTombstone(
      persistence,
      "workspace-1",
      "runtime-old",
      ["client-old"],
    );

    expect(committedReplacedSessionTombstonesForWorkspace("workspace-1"))
      .toEqual(["runtime-old"]);
    expect(isReplacedSessionTombstoned("workspace-1", "client-old")).toBe(true);

    await clearReplacedSessionTombstone(persistence, "workspace-1", "runtime-old");
    expect(committedReplacedSessionTombstonesForWorkspace("workspace-1")).toEqual([]);
    expect(isReplacedSessionTombstoned("workspace-1", "runtime-old")).toBe(true);
    expect(isReplacedSessionTombstoned("workspace-1", "client-old")).toBe(true);
    expect(filterReplacedSessionTombstones("workspace-1", [{ id: "runtime-old" }]))
      .toEqual([]);

    await releaseReplacedSessionSuppression(persistence, "workspace-1", "runtime-old");
    expect(isReplacedSessionTombstoned("workspace-1", "runtime-old")).toBe(false);
    expect(isReplacedSessionTombstoned("workspace-1", "client-old")).toBe(false);
  });

  it("does not report or promote durability before the exact write completes", async () => {
    const writeGate = deferred<void>();
    storage.setItem.mockImplementationOnce(() => writeGate.promise);
    stageReplacedSessionTombstone("workspace-1", "runtime-old", ["client-old"]);

    const commit = commitReplacedSessionTombstone(
      persistence,
      "workspace-1",
      "runtime-old",
      ["client-old"],
    );
    expect(committedReplacedSessionTombstonesForWorkspace("workspace-1")).toEqual([]);
    expect(isReplacedSessionTombstoned("workspace-1", "runtime-old")).toBe(true);

    writeGate.resolve();
    await expect(commit).resolves.toBe(true);
    expect(committedReplacedSessionTombstonesForWorkspace("workspace-1"))
      .toEqual(["runtime-old"]);
  });

  it("keeps a staged fence and reports false when its durable write fails", async () => {
    storage.setItem.mockRejectedValueOnce(new Error("write failed"));
    stageReplacedSessionTombstone("workspace-1", "runtime-old", ["client-old"]);

    await expect(commitReplacedSessionTombstone(
      persistence,
      "workspace-1",
      "runtime-old",
      ["client-old"],
    )).resolves.toBe(false);

    expect(committedReplacedSessionTombstonesForWorkspace("workspace-1")).toEqual([]);
    expect(isReplacedSessionTombstoned("workspace-1", "runtime-old")).toBe(true);
  });

  it("does not promote an old in-flight write after storage replacement", async () => {
    const writeGate = deferred<void>();
    storage.setItem.mockImplementationOnce(() => writeGate.promise);
    stageReplacedSessionTombstone("workspace-1", "runtime-old");
    const commit = commitReplacedSessionTombstone(
      persistence,
      "workspace-1",
      "runtime-old",
    );

    await vi.waitFor(() => expect(isReplacedSessionTombstoned(
      "workspace-1",
      "runtime-old",
    )).toBe(true));
    const replacementStorage = {
      getItem: vi.fn(async () => null),
      setItem: vi.fn<(
        key: string,
        value: string,
      ) => Promise<void>>(async () => undefined),
      removeItem: vi.fn<(key: string) => Promise<void>>(async () => undefined),
    };
    beginSessionReplacementTombstoneHydration(replacementStorage);
    prepareSessionReplacementTombstonesForStorage(replacementStorage);
    settleSessionReplacementTombstoneHydration(false);
    writeGate.resolve();

    await expect(commit).resolves.toBe(false);
    expect(committedReplacedSessionTombstonesForWorkspace("workspace-1")).toEqual([]);
  });

});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
