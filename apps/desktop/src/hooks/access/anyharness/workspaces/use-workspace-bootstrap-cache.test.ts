// @vitest-environment jsdom

import { createElement, type ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  AnyHarnessRuntime,
  anyHarnessSessionsKey,
} from "@anyharness/sdk-react";
import type { ProductHost } from "@proliferate/product-client/host/product-host";
import { ProductHostProvider } from "@proliferate/product-client/host/ProductHostProvider";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  commitReplacedSessionTombstone,
  committedReplacedSessionTombstonesForWorkspace,
  prepareSessionReplacementTombstonesForStorage,
  resetReplacedSessionTombstonesForTests,
} from "@/hooks/sessions/workflows/session-replacement-tombstone-durable-operations";
import {
  isReplacedSessionTombstoned,
  stageReplacedSessionTombstone,
} from "@/hooks/sessions/workflows/session-replacement-tombstones";
import {
  reconcileReplacedSessionTombstones,
  useWorkspaceBootstrapCache,
} from "./use-workspace-bootstrap-cache";
import {
  resetSessionReplacementDismissalsForTests,
} from "@/hooks/sessions/workflows/session-replacement-dismissals";
import {
  beginSessionReplacementTombstoneHydration,
  settleSessionReplacementTombstoneHydration,
} from "@/hooks/sessions/workflows/session-replacement-tombstone-authority";

const mocks = vi.hoisted(() => ({
  dismissSession: vi.fn(async () => undefined),
  listWorkspaceSessions: vi.fn(),
}));

const CACHE_SCOPE_KEY = "desktop:test-user";
const storage = {
  getItem: vi.fn(async () => null),
  setItem: vi.fn(async () => {}),
  removeItem: vi.fn(async () => {}),
};
const host = {
  storage,
  telemetry: { captureException: vi.fn() },
} as unknown as ProductHost;
const persistence = {
  storage,
  captureException: host.telemetry.captureException,
};

vi.mock("@/lib/access/anyharness/sessions", () => ({
  dismissSession: mocks.dismissSession,
  listWorkspaceSessions: mocks.listWorkspaceSessions,
}));

beforeEach(() => {
  mocks.dismissSession.mockClear();
  mocks.listWorkspaceSessions.mockClear();
  resetReplacedSessionTombstonesForTests();
  beginSessionReplacementTombstoneHydration(storage);
  prepareSessionReplacementTombstonesForStorage(storage);
  settleSessionReplacementTombstoneHydration(false);
  resetSessionReplacementDismissalsForTests();
});

describe("replacement tombstone reconciliation", () => {
  it("clears only after an authoritative list omits the retired session", async () => {
    const input = {
      workspaceConnection: {} as never,
      workspaceId: "workspace-1",
    };
    await commitReplacedSessionTombstone(persistence, "workspace-1", "runtime-old");

    reconcileReplacedSessionTombstones(persistence, input, [{ id: "runtime-old" }]);

    await vi.waitFor(() => {
      expect(mocks.dismissSession).toHaveBeenCalledWith({}, "runtime-old");
    });
    expect(isReplacedSessionTombstoned("workspace-1", "runtime-old")).toBe(true);

    reconcileReplacedSessionTombstones(persistence, input, []);

    await vi.waitFor(() => {
      expect(committedReplacedSessionTombstonesForWorkspace("workspace-1")).toEqual([]);
    });
    expect(isReplacedSessionTombstoned("workspace-1", "runtime-old")).toBe(true);
  });

  it("does not dismiss a staged replacement during an authoritative list", () => {
    stageReplacedSessionTombstone("workspace-1", "runtime-old", ["client-old"]);

    reconcileReplacedSessionTombstones(persistence, {
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
    const wrapper = createWrapper(queryClient, "http://runtime.test");
    const { result } = renderHook(() => useWorkspaceBootstrapCache(), { wrapper });
    const firstList = result.current.fetchWorkspaceSessions({
      workspaceConnection: {} as never,
      workspaceId: "workspace-1",
    });
    await vi.waitFor(() => expect(mocks.listWorkspaceSessions).toHaveBeenCalledTimes(1));

    await commitReplacedSessionTombstone(
      persistence,
      "workspace-1",
      "runtime-created-later",
    );
    listGate.resolve([]);
    await firstList;

    expect(committedReplacedSessionTombstonesForWorkspace("workspace-1"))
      .toEqual(["runtime-created-later"]);

    mocks.listWorkspaceSessions.mockResolvedValueOnce([]);
    await result.current.fetchWorkspaceSessions({
      workspaceConnection: {} as never,
      workspaceId: "workspace-1",
    });
    await vi.waitFor(() => {
      expect(committedReplacedSessionTombstonesForWorkspace("workspace-1")).toEqual([]);
    });
  });
});

function createWrapper(queryClient: QueryClient, runtimeUrl: string) {
  return ({ children }: { children: ReactNode }) => createElement(
    ProductHostProvider,
    {
      host,
      children: createElement(
      QueryClientProvider,
        {
          client: queryClient,
          children: createElement(
            AnyHarnessRuntime,
            { runtimeUrl, cacheScopeKey: CACHE_SCOPE_KEY, children },
          ),
        },
      ),
    },
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
