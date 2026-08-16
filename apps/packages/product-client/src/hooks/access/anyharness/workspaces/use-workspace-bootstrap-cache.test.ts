// @vitest-environment jsdom

import { createElement, type ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  AnyHarnessRuntime,
  anyHarnessSessionsKey,
} from "@anyharness/sdk-react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  commitReplacedSessionTombstone,
  committedReplacedSessionTombstonesForWorkspace,
  isReplacedSessionTombstoned,
  resetReplacedSessionTombstonesForTests,
  stageReplacedSessionTombstone,
} from "#product/hooks/sessions/workflows/session-replacement-tombstones";
import {
  reconcileReplacedSessionTombstones,
  useWorkspaceBootstrapCache,
} from "#product/hooks/access/anyharness/workspaces/use-workspace-bootstrap-cache";
import {
  resetSessionReplacementDismissalsForTests,
} from "#product/hooks/sessions/workflows/session-replacement-dismissals";
import {
  resetWorkspaceSessionsWarmPinsForTest,
  warmWorkspaceSessionsPinCountForTest,
} from "#product/hooks/access/anyharness/workspaces/workspace-session-directory-keepalive";

const mocks = vi.hoisted(() => ({
  dismissSession: vi.fn(async () => undefined),
  listWorkspaceSessions: vi.fn(),
  writeSessionReplacementTombstones: vi.fn(() => true),
}));

const CACHE_SCOPE_KEY = "desktop:test-user";

vi.mock("#product/lib/access/persistence/session-replacement-tombstones-storage", () => ({
  readSessionReplacementTombstones: () => ({}),
  writeSessionReplacementTombstones: mocks.writeSessionReplacementTombstones,
}));

vi.mock("#product/lib/access/anyharness/sessions", () => ({
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
  resetWorkspaceSessionsWarmPinsForTest();
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

  it("filters staged replacements from the warm first-paint serve without destructively reconciling them", async () => {
    // R14: a warm serve now kicks a background revalidation (founder ruling:
    // not stale-tolerant). It must still NOT destructively reconcile a STAGED
    // (uncommitted) replacement — dismissSession must never fire for it.
    mocks.listWorkspaceSessions.mockResolvedValueOnce([
      { id: "runtime-old" },
      { id: "runtime-new" },
    ]);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const runtimeUrl = "http://runtime.test";
    queryClient.setQueryData(anyHarnessSessionsKey(CACHE_SCOPE_KEY, "workspace-1"), [
      { id: "runtime-old", workspaceId: "workspace-1" },
      { id: "runtime-new", workspaceId: "workspace-1" },
    ]);
    stageReplacedSessionTombstone("workspace-1", "runtime-old", ["client-old"]);
    const wrapper = createWrapper(queryClient, runtimeUrl);
    const { result } = renderHook(() => useWorkspaceBootstrapCache(), { wrapper });

    const sessions = await result.current.loadWorkspaceSessions({
      workspaceConnection: {} as never,
      workspaceId: "workspace-1",
    });

    // First-paint serve is the warm, filtered cache — returned synchronously
    // without blocking on the network.
    expect(sessions).toEqual([{ id: "runtime-new", workspaceId: "workspace-1" }]);
    // A staged replacement is never dismissed, even by the background fetch.
    await vi.waitFor(() =>
      expect(mocks.listWorkspaceSessions).toHaveBeenCalledTimes(1),
    );
    expect(mocks.dismissSession).not.toHaveBeenCalled();
  });

  it("keeps the sessions query warm and reports a hit after a fresh load", async () => {
    mocks.listWorkspaceSessions.mockResolvedValueOnce([{ id: "s1" }]);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = createWrapper(queryClient, "http://runtime.test");
    const { result } = renderHook(() => useWorkspaceBootstrapCache(), { wrapper });

    expect(result.current.getWorkspaceSessionsCacheDecision("workspace-1")).toBe("miss");
    await result.current.loadWorkspaceSessions({
      workspaceConnection: {} as never,
      workspaceId: "workspace-1",
    });

    // The query was pinned warm (bounded LRU) and now reports a truthful hit.
    expect(warmWorkspaceSessionsPinCountForTest()).toBeGreaterThan(0);
    expect(result.current.getWorkspaceSessionsCacheDecision("workspace-1")).toBe("hit");
  });

  it("revalidates a warm serve in the background and updates the cache", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const queryKey = anyHarnessSessionsKey(CACHE_SCOPE_KEY, "workspace-1");
    queryClient.setQueryData(queryKey, [{ id: "stale-1", workspaceId: "workspace-1" }]);
    mocks.listWorkspaceSessions.mockResolvedValueOnce([{ id: "fresh-1" }]);
    const wrapper = createWrapper(queryClient, "http://runtime.test");
    const { result } = renderHook(() => useWorkspaceBootstrapCache(), { wrapper });

    const served = await result.current.loadWorkspaceSessions({
      workspaceConnection: {} as never,
      workspaceId: "workspace-1",
    });
    // Warm value served for first paint.
    expect(served).toEqual([{ id: "stale-1", workspaceId: "workspace-1" }]);
    // Background revalidation fetched and seeded the fresh list.
    await vi.waitFor(() => {
      expect(queryClient.getQueryData(queryKey)).toEqual([
        { id: "fresh-1", workspaceId: "workspace-1" },
      ]);
    });
  });

  it("invalidates a warm entry when a replaced-session tombstone commits", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const queryKey = anyHarnessSessionsKey(CACHE_SCOPE_KEY, "workspace-1");
    queryClient.setQueryData(queryKey, [{ id: "runtime-old", workspaceId: "workspace-1" }]);
    const wrapper = createWrapper(queryClient, "http://runtime.test");
    const { result } = renderHook(() => useWorkspaceBootstrapCache(), { wrapper });
    expect(result.current.getWorkspaceSessionsCacheDecision("workspace-1")).toBe("hit");

    commitReplacedSessionTombstone("workspace-1", "runtime-old");

    await vi.waitFor(() =>
      expect(result.current.getWorkspaceSessionsCacheDecision("workspace-1")).toBe("stale"),
    );
  });

  it("does not cache a forced response after its selection ownership becomes stale", async () => {
    const listGate = deferred<Array<{ id: string }>>();
    mocks.listWorkspaceSessions.mockReturnValueOnce(listGate.promise);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const queryKey = anyHarnessSessionsKey(CACHE_SCOPE_KEY, "workspace-1");
    const wrapper = createWrapper(queryClient, "http://runtime.test");
    const { result } = renderHook(() => useWorkspaceBootstrapCache(), { wrapper });
    let current = true;
    commitReplacedSessionTombstone("workspace-1", "retired");

    const staleLoad = result.current.loadWorkspaceSessions({
      forceRefresh: true,
      isCurrent: () => current,
      workspaceConnection: {} as never,
      workspaceId: "workspace-1",
    });
    await vi.waitFor(() => expect(mocks.listWorkspaceSessions).toHaveBeenCalledTimes(1));
    current = false;
    listGate.resolve([{ id: "stale" }]);
    await expect(staleLoad).resolves.toEqual([
      { id: "stale", workspaceId: "workspace-1" },
    ]);
    expect(queryClient.getQueryData(queryKey)).toBeUndefined();
    expect(committedReplacedSessionTombstonesForWorkspace("workspace-1"))
      .toEqual(["retired"]);

    mocks.listWorkspaceSessions.mockResolvedValueOnce([{ id: "later" }]);
    await expect(result.current.loadWorkspaceSessions({
      workspaceConnection: {} as never,
      workspaceId: "workspace-1",
    })).resolves.toEqual([{ id: "later", workspaceId: "workspace-1" }]);
    expect(mocks.listWorkspaceSessions).toHaveBeenCalledTimes(2);
  });

  it.each([
    { label: "non-empty", listed: [{ id: "new" }] },
    { label: "empty", listed: [] },
  ])("caches a current forced $label response", async ({ listed }) => {
    mocks.listWorkspaceSessions.mockResolvedValueOnce(listed);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const queryKey = anyHarnessSessionsKey(CACHE_SCOPE_KEY, "workspace-1");
    const wrapper = createWrapper(queryClient, "http://runtime.test");
    const { result } = renderHook(() => useWorkspaceBootstrapCache(), { wrapper });

    const sessions = await result.current.loadWorkspaceSessions({
      forceRefresh: true,
      isCurrent: () => true,
      workspaceConnection: {} as never,
      workspaceId: "workspace-1",
    });

    expect(queryClient.getQueryData(queryKey)).toEqual(sessions);
  });

  it("does not clear a tombstone committed after the list request began", async () => {
    const listGate = deferred<Array<{ id: string }>>();
    mocks.listWorkspaceSessions.mockReturnValueOnce(listGate.promise);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = createWrapper(queryClient, "http://runtime.test");
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

function createWrapper(queryClient: QueryClient, runtimeUrl: string) {
  return ({ children }: { children: ReactNode }) => createElement(
    QueryClientProvider,
    { client: queryClient },
    createElement(
      AnyHarnessRuntime,
      { runtimeUrl, cacheScopeKey: CACHE_SCOPE_KEY, children },
    ),
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
