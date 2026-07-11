// @vitest-environment jsdom

import { createElement, type ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { anyHarnessSessionsKey } from "@anyharness/sdk-react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  commitReplacedSessionTombstone,
  committedReplacedSessionTombstonesForWorkspace,
  isReplacedSessionTombstoned,
  resetReplacedSessionTombstonesForTests,
  stageReplacedSessionTombstone,
} from "@/hooks/sessions/workflows/session-replacement-tombstones";
import {
  reconcileReplacedSessionTombstones,
  useWorkspaceBootstrapCache,
} from "./use-workspace-bootstrap-cache";
import {
  resetSessionReplacementDismissalsForTests,
} from "@/hooks/sessions/workflows/session-replacement-dismissals";

const mocks = vi.hoisted(() => ({
  dismissSession: vi.fn(async () => undefined),
  listWorkspaceSessions: vi.fn(),
  writeSessionReplacementTombstones: vi.fn(() => true),
}));

vi.mock("@/lib/access/browser/session-replacement-tombstones-storage", () => ({
  readSessionReplacementTombstones: () => ({}),
  writeSessionReplacementTombstones: mocks.writeSessionReplacementTombstones,
}));

vi.mock("@/lib/access/anyharness/sessions", () => ({
  dismissSession: mocks.dismissSession,
  listWorkspaceSessions: mocks.listWorkspaceSessions,
}));

beforeEach(() => {
  mocks.dismissSession.mockClear();
  mocks.listWorkspaceSessions.mockClear();
  mocks.writeSessionReplacementTombstones.mockClear();
  mocks.writeSessionReplacementTombstones.mockReturnValue(true);
  resetReplacedSessionTombstonesForTests();
  resetSessionReplacementDismissalsForTests();
});

describe("replacement tombstone reconciliation", () => {
  it("clears only after an authoritative list omits the retired session", async () => {
    const input = {
      workspaceConnection: {} as never,
      workspaceId: "workspace-1",
    };
    commitReplacedSessionTombstone("workspace-1", "runtime-old");

    reconcileReplacedSessionTombstones(input, [{ id: "runtime-old" }]);

    await vi.waitFor(() => {
      expect(mocks.dismissSession).toHaveBeenCalledWith({}, "runtime-old");
    });
    expect(isReplacedSessionTombstoned("workspace-1", "runtime-old")).toBe(true);

    reconcileReplacedSessionTombstones(input, []);

    expect(committedReplacedSessionTombstonesForWorkspace("workspace-1")).toEqual([]);
    expect(isReplacedSessionTombstoned("workspace-1", "runtime-old")).toBe(true);
  });

  it("does not dismiss a staged replacement during an authoritative list", () => {
    stageReplacedSessionTombstone("workspace-1", "runtime-old", ["client-old"]);

    reconcileReplacedSessionTombstones({
      workspaceConnection: {} as never,
      workspaceId: "workspace-1",
    }, [{ id: "runtime-old" }]);

    expect(mocks.dismissSession).not.toHaveBeenCalled();
    expect(committedReplacedSessionTombstonesForWorkspace("workspace-1"))
      .toEqual([]);
    expect(isReplacedSessionTombstoned("workspace-1", "client-old")).toBe(true);
  });

  it("filters staged replacements from cache hits without reconciling them", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const runtimeUrl = "http://runtime.test";
    queryClient.setQueryData(anyHarnessSessionsKey(runtimeUrl, "workspace-1"), [
      { id: "runtime-old", workspaceId: "workspace-1" },
      { id: "runtime-new", workspaceId: "workspace-1" },
    ]);
    stageReplacedSessionTombstone("workspace-1", "runtime-old", ["client-old"]);
    const wrapper = ({ children }: { children: ReactNode }) => createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
    const { result } = renderHook(() => useWorkspaceBootstrapCache(), { wrapper });

    const sessions = await result.current.loadWorkspaceSessions({
      runtimeUrl,
      workspaceConnection: {} as never,
      workspaceId: "workspace-1",
    });

    expect(sessions).toEqual([{ id: "runtime-new", workspaceId: "workspace-1" }]);
    expect(mocks.listWorkspaceSessions).not.toHaveBeenCalled();
    expect(mocks.dismissSession).not.toHaveBeenCalled();
  });

  it("does not clear a tombstone committed after the list request began", async () => {
    const listGate = deferred<Array<{ id: string }>>();
    mocks.listWorkspaceSessions.mockReturnValueOnce(listGate.promise);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
    const { result } = renderHook(() => useWorkspaceBootstrapCache(), { wrapper });
    const firstList = result.current.fetchWorkspaceSessions({
      workspaceConnection: {} as never,
      workspaceId: "workspace-1",
    });
    await vi.waitFor(() => expect(mocks.listWorkspaceSessions).toHaveBeenCalledTimes(1));

    commitReplacedSessionTombstone("workspace-1", "runtime-created-later");
    listGate.resolve([]);
    await firstList;

    expect(committedReplacedSessionTombstonesForWorkspace("workspace-1"))
      .toEqual(["runtime-created-later"]);

    mocks.listWorkspaceSessions.mockResolvedValueOnce([]);
    await result.current.fetchWorkspaceSessions({
      workspaceConnection: {} as never,
      workspaceId: "workspace-1",
    });
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
