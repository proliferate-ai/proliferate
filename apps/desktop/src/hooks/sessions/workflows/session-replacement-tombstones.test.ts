import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearStagedReplacedClientSessionAlias,
  clearReplacedSessionTombstone,
  clearStagedReplacedSessionTombstone,
  commitReplacedSessionTombstone,
  committedReplacedSessionTombstonesForWorkspace,
  filterReplacedSessionTombstones,
  filterReplacedSessionIds,
  isReplacedSessionTombstoned,
  isReplacedSessionTombstonedInAnyWorkspace,
  releaseReplacedSessionSuppression,
  resetReplacedSessionTombstonesForTests,
  retireStagedReplacedClientSessionAlias,
  shouldPreserveStagedReplacementShell,
  stageReplacedClientSessionAlias,
  stageReplacedSessionTombstone,
} from "@/hooks/sessions/workflows/session-replacement-tombstones";

const storageMocks = vi.hoisted(() => ({
  writeTombstones: vi.fn(() => true),
}));

vi.mock("@/lib/access/persistence/session-replacement-tombstones-storage", () => ({
  setSessionReplacementTombstonesStorageContext: () => {},
  hydrateSessionReplacementTombstones: async () => ({}),
  writeSessionReplacementTombstones: storageMocks.writeTombstones,
}));

beforeEach(() => {
  storageMocks.writeTombstones.mockReset();
  storageMocks.writeTombstones.mockReturnValue(true);
  resetReplacedSessionTombstonesForTests();
});

describe("replacement session tombstones", () => {
  it("suppresses a client-only replacement without making it dismissible", () => {
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
    releaseReplacedSessionSuppression("workspace-1", "client-old");
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

  it("commits the runtime id and aliases until authoritative cleanup", () => {
    stageReplacedSessionTombstone("workspace-1", "runtime-old", ["client-old"]);
    commitReplacedSessionTombstone("workspace-1", "runtime-old", ["client-old"]);

    expect(committedReplacedSessionTombstonesForWorkspace("workspace-1"))
      .toEqual(["runtime-old"]);
    expect(isReplacedSessionTombstoned("workspace-1", "client-old")).toBe(true);

    clearReplacedSessionTombstone("workspace-1", "runtime-old");
    expect(committedReplacedSessionTombstonesForWorkspace("workspace-1")).toEqual([]);
    expect(isReplacedSessionTombstoned("workspace-1", "runtime-old")).toBe(true);
    expect(isReplacedSessionTombstoned("workspace-1", "client-old")).toBe(true);
    expect(filterReplacedSessionTombstones("workspace-1", [{ id: "runtime-old" }]))
      .toEqual([]);

    releaseReplacedSessionSuppression("workspace-1", "runtime-old");
    expect(isReplacedSessionTombstoned("workspace-1", "runtime-old")).toBe(false);
    expect(isReplacedSessionTombstoned("workspace-1", "client-old")).toBe(false);
  });

  it("keeps a durable tombstone when clearing persistence fails", () => {
    stageReplacedSessionTombstone("workspace-1", "runtime-old", ["client-old"]);
    expect(commitReplacedSessionTombstone(
      "workspace-1",
      "runtime-old",
      ["client-old"],
    )).toBe(true);
    storageMocks.writeTombstones.mockReturnValue(false);

    expect(clearReplacedSessionTombstone("workspace-1", "runtime-old")).toBe(false);
    expect(releaseReplacedSessionSuppression("workspace-1", "runtime-old"))
      .toBe(false);
    expect(committedReplacedSessionTombstonesForWorkspace("workspace-1"))
      .toEqual(["runtime-old"]);
    expect(isReplacedSessionTombstoned("workspace-1", "client-old")).toBe(true);

    storageMocks.writeTombstones.mockReturnValue(true);
    expect(clearReplacedSessionTombstone("workspace-1", "runtime-old")).toBe(true);
  });
});
