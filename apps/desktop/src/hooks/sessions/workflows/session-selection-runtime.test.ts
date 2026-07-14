import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearReplacedSessionTombstone,
  commitReplacedSessionTombstone,
  resetReplacedSessionTombstonesForTests,
  stageReplacedSessionTombstone,
} from "@/hooks/sessions/workflows/session-replacement-tombstones";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import {
  fetchWorkspaceSessions,
  resolveRuntimeUrlForWorkspaceSessions,
} from "./session-selection-runtime";

const mocks = vi.hoisted(() => ({
  bootstrapHarnessRuntime: vi.fn(),
  fetchWorkspaceSessionSummaries: vi.fn(),
}));

vi.mock("@/lib/access/anyharness/session-runtime", () => ({
  fetchWorkspaceSessionSummaries: mocks.fetchWorkspaceSessionSummaries,
}));

vi.mock("@/lib/access/anyharness/runtime-bootstrap", () => ({
  bootstrapHarnessRuntime: mocks.bootstrapHarnessRuntime,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchWorkspaceSessionSummaries.mockReset();
  useHarnessConnectionStore.setState({
    runtimeUrl: "",
    connectionState: "connecting",
    error: null,
  });
  resetReplacedSessionTombstonesForTests();
});

describe("session runtime selection", () => {
  it.each(["cloud:cloud-1", "target:target-1:workspace-1"])(
    "does not discover a local runtime for %s",
    async (workspaceId) => {
      await expect(resolveRuntimeUrlForWorkspaceSessions(workspaceId, null)).resolves.toBe("");
      expect(mocks.bootstrapHarnessRuntime).not.toHaveBeenCalled();
    },
  );

  it("uses the injected Desktop bridge for a local workspace", async () => {
    const runtime = { getConnection: vi.fn(), restart: vi.fn() };
    mocks.bootstrapHarnessRuntime.mockImplementation(async () => {
      useHarnessConnectionStore.setState({
        runtimeUrl: "http://runtime.test",
        connectionState: "healthy",
        error: null,
      });
    });

    await expect(
      resolveRuntimeUrlForWorkspaceSessions("workspace-1", runtime),
    ).resolves.toBe("http://runtime.test");
    expect(mocks.bootstrapHarnessRuntime).toHaveBeenCalledWith(runtime);
  });
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
