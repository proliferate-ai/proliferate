// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetReplacedSessionTombstonesForTests,
  stageReplacedSessionTombstone,
} from "@/hooks/sessions/workflows/session-replacement-tombstones";
import { useWorkspaceSessionLoader } from "./use-workspace-session-loader";

const mocks = vi.hoisted(() => ({
  cloudClient: {},
  localRuntime: {},
  ssh: {},
  ensureRuntimeReadyForSessions: vi.fn(async () => "http://runtime.test"),
  fetchWorkspaceSessions: vi.fn(),
  getWorkspaceRuntimeBlockReason: vi.fn(() => null),
  getWorkspaceSessionCacheSnapshot: vi.fn(),
  setWorkspaceSessions: vi.fn(),
}));

vi.mock("@proliferate/product-client/host/ProductHostProvider", () => ({
  useProductHost: () => ({
    cloud: { client: mocks.cloudClient },
    desktop: { runtime: mocks.localRuntime, ssh: mocks.ssh },
  }),
}));

vi.mock("@/hooks/access/anyharness/sessions/use-workspace-session-cache", () => ({
  useWorkspaceSessionCache: () => ({
    getWorkspaceSessionCacheSnapshot: mocks.getWorkspaceSessionCacheSnapshot,
    setWorkspaceSessions: mocks.setWorkspaceSessions,
  }),
}));

vi.mock("@/hooks/workspaces/derived/use-workspace-runtime-block", () => ({
  useWorkspaceRuntimeBlock: () => ({
    getWorkspaceRuntimeBlockReason: mocks.getWorkspaceRuntimeBlockReason,
  }),
}));

vi.mock("@/hooks/sessions/workflows/session-selection-runtime", () => ({
  ensureRuntimeReadyForSessions: mocks.ensureRuntimeReadyForSessions,
  fetchWorkspaceSessions: mocks.fetchWorkspaceSessions,
}));

beforeEach(() => {
  vi.clearAllMocks();
  resetReplacedSessionTombstonesForTests();
});

afterEach(() => cleanup());

describe("useWorkspaceSessionLoader replacement filtering", () => {
  it("filters a staged runtime from a cache hit", async () => {
    mocks.getWorkspaceSessionCacheSnapshot.mockReturnValue({
      sessions: [
        { id: "runtime-old", workspaceId: "workspace-1" },
        { id: "runtime-new", workspaceId: "workspace-1" },
      ],
      dataUpdatedAt: 1,
      isInvalidated: false,
    });
    stageReplacedSessionTombstone("workspace-1", "runtime-old", ["client-old"]);
    const { result } = renderHook(() => useWorkspaceSessionLoader());

    const sessions = await result.current.ensureWorkspaceSessions("workspace-1");

    expect(sessions).toEqual([{ id: "runtime-new", workspaceId: "workspace-1" }]);
    expect(mocks.fetchWorkspaceSessions).not.toHaveBeenCalled();
  });

  it("filters before writing a fetched session list back to cache", async () => {
    mocks.getWorkspaceSessionCacheSnapshot.mockReturnValue({
      sessions: undefined,
      dataUpdatedAt: 0,
      isInvalidated: false,
    });
    mocks.fetchWorkspaceSessions.mockResolvedValue([
      { id: "runtime-old", workspaceId: "workspace-1" },
      { id: "runtime-new", workspaceId: "workspace-1" },
    ]);
    stageReplacedSessionTombstone("workspace-1", "runtime-old", ["client-old"]);
    const { result } = renderHook(() => useWorkspaceSessionLoader());

    const sessions = await result.current.ensureWorkspaceSessions("workspace-1");

    expect(sessions).toEqual([{ id: "runtime-new", workspaceId: "workspace-1" }]);
    expect(mocks.ensureRuntimeReadyForSessions).toHaveBeenCalledWith(mocks.localRuntime);
    const updater = mocks.setWorkspaceSessions.mock.calls[0]?.[1] as
      ((current: unknown) => unknown) | undefined;
    expect(updater?.(undefined)).toEqual([
      { id: "runtime-new", workspaceId: "workspace-1" },
    ]);
  });

  it("passes the Desktop SSH bridge when target listing has no metadata", async () => {
    mocks.getWorkspaceSessionCacheSnapshot.mockReturnValue({
      sessions: undefined,
      dataUpdatedAt: 0,
      isInvalidated: false,
    });
    mocks.fetchWorkspaceSessions.mockResolvedValue([]);
    const { result } = renderHook(() => useWorkspaceSessionLoader());

    await result.current.ensureWorkspaceSessions("target:target-1:workspace-1");

    expect(mocks.ensureRuntimeReadyForSessions).not.toHaveBeenCalled();
    expect(mocks.fetchWorkspaceSessions).toHaveBeenCalledWith(
      expect.any(String),
      "target:target-1:workspace-1",
      {
        requestHeaders: undefined,
        measurementOperationId: undefined,
        cloudClient: mocks.cloudClient,
        ssh: mocks.ssh,
      },
    );
  });
});
