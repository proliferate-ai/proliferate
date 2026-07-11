import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearReplacedSessionTombstone,
  commitReplacedSessionTombstone,
  resetReplacedSessionTombstonesForTests,
  stageReplacedSessionTombstone,
} from "@/hooks/sessions/workflows/session-replacement-tombstones";
import { fetchWorkspaceSessions } from "./session-selection-runtime";

const mocks = vi.hoisted(() => ({
  fetchWorkspaceSessionSummaries: vi.fn(),
}));

vi.mock("@/lib/access/anyharness/session-runtime", () => ({
  fetchWorkspaceSessionSummaries: mocks.fetchWorkspaceSessionSummaries,
}));

vi.mock("@/lib/access/anyharness/runtime-bootstrap", () => ({
  bootstrapHarnessRuntime: vi.fn(),
}));

beforeEach(() => {
  mocks.fetchWorkspaceSessionSummaries.mockReset();
  resetReplacedSessionTombstonesForTests();
});

describe("selection session-list filtering", () => {
  it("does not return a staged replacement runtime", async () => {
    mocks.fetchWorkspaceSessionSummaries.mockResolvedValue([
      { id: "runtime-old" },
      { id: "runtime-new" },
    ]);
    stageReplacedSessionTombstone("workspace-1", "runtime-old", ["client-old"]);

    const sessions = await fetchWorkspaceSessions("http://runtime.test", "workspace-1");

    expect(sessions).toEqual([{ id: "runtime-new", workspaceId: "workspace-1" }]);
  });

  it("filters an out-of-order old response after authoritative cleanup", async () => {
    commitReplacedSessionTombstone("workspace-1", "runtime-old", ["client-old"]);
    clearReplacedSessionTombstone("workspace-1", "runtime-old");
    mocks.fetchWorkspaceSessionSummaries.mockResolvedValue([{ id: "runtime-old" }]);

    const sessions = await fetchWorkspaceSessions("http://runtime.test", "workspace-1");

    expect(sessions).toEqual([]);
  });
});
