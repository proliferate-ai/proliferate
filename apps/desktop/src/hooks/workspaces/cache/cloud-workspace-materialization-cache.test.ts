import {
  anyHarnessAgentLaunchOptionsKey,
  anyHarnessGitStatusKey,
  anyHarnessSessionsKey,
  anyHarnessWorkspaceFileTreeKey,
  anyHarnessWorkspaceKey,
} from "@anyharness/sdk-react";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import {
  createCloudWorkspaceMaterializationCacheTracker,
} from "./cloud-workspace-materialization-cache";

const CACHE_SCOPE_KEY = "https://api.test::user:user-1";
const CLOUD_WORKSPACE_ID = "cloud-workspace-1";
const LOGICAL_WORKSPACE_ID = `cloud:${CLOUD_WORKSPACE_ID}`;

function connection(input: {
  anyharnessWorkspaceId?: string;
  runtimeGeneration?: number;
  accessToken?: string;
}) {
  return {
    runtimeUrl: "https://gateway.test/v1/anyharness",
    accessToken: input.accessToken ?? "token-1",
    anyharnessWorkspaceId: input.anyharnessWorkspaceId ?? "runtime-workspace-1",
    runtimeGeneration: input.runtimeGeneration ?? 1,
    allowedAgentKinds: [],
    readyAgentKinds: [],
  };
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
}

function seedWorkspaceCache(queryClient: QueryClient) {
  queryClient.setQueryData(
    anyHarnessWorkspaceKey(CACHE_SCOPE_KEY, LOGICAL_WORKSPACE_ID),
    { id: "workspace" },
  );
  queryClient.setQueryData(
    anyHarnessSessionsKey(CACHE_SCOPE_KEY, LOGICAL_WORKSPACE_ID),
    [{ id: "session-1" }],
  );
  queryClient.setQueryData(
    anyHarnessGitStatusKey(CACHE_SCOPE_KEY, LOGICAL_WORKSPACE_ID),
    { currentBranch: "main" },
  );
  queryClient.setQueryData(
    anyHarnessWorkspaceFileTreeKey(CACHE_SCOPE_KEY, LOGICAL_WORKSPACE_ID, "."),
    [{ path: "README.md" }],
  );
  queryClient.setQueryData(
    anyHarnessAgentLaunchOptionsKey(
      "https://gateway.test/v1/anyharness",
      "runtime-workspace-1",
      CACHE_SCOPE_KEY,
    ),
    { agents: [] },
  );
}

describe("cloud workspace materialization cache", () => {
  it("keeps workspace cache through a gateway token refresh", async () => {
    const queryClient = createQueryClient();
    const tracker = createCloudWorkspaceMaterializationCacheTracker({
      queryClient,
      cacheScopeKey: CACHE_SCOPE_KEY,
    });
    seedWorkspaceCache(queryClient);

    await tracker.observe({ cloudWorkspaceId: CLOUD_WORKSPACE_ID, connection: connection({
      accessToken: "token-1",
    }) });
    await tracker.observe({ cloudWorkspaceId: CLOUD_WORKSPACE_ID, connection: connection({
      accessToken: "token-2",
    }) });

    expect(queryClient.getQueryData(
      anyHarnessSessionsKey(CACHE_SCOPE_KEY, LOGICAL_WORKSPACE_ID),
    )).toEqual([{ id: "session-1" }]);
  });

  it.each([
    ["AnyHarness workspace replacement", connection({ anyharnessWorkspaceId: "runtime-workspace-2" })],
    ["runtime generation change", connection({ runtimeGeneration: 2 })],
  ])("clears every workspace descendant after %s", async (_label, replacement) => {
    const queryClient = createQueryClient();
    const tracker = createCloudWorkspaceMaterializationCacheTracker({
      queryClient,
      cacheScopeKey: CACHE_SCOPE_KEY,
    });
    seedWorkspaceCache(queryClient);

    await tracker.observe({ cloudWorkspaceId: CLOUD_WORKSPACE_ID, connection: connection({}) });
    await tracker.observe({ cloudWorkspaceId: CLOUD_WORKSPACE_ID, connection: replacement });

    expect(queryClient.getQueryData(
      anyHarnessWorkspaceKey(CACHE_SCOPE_KEY, LOGICAL_WORKSPACE_ID),
    )).toBeUndefined();
    expect(queryClient.getQueryData(
      anyHarnessSessionsKey(CACHE_SCOPE_KEY, LOGICAL_WORKSPACE_ID),
    )).toBeUndefined();
    expect(queryClient.getQueryData(
      anyHarnessGitStatusKey(CACHE_SCOPE_KEY, LOGICAL_WORKSPACE_ID),
    )).toBeUndefined();
    expect(queryClient.getQueryData(
      anyHarnessWorkspaceFileTreeKey(CACHE_SCOPE_KEY, LOGICAL_WORKSPACE_ID, "."),
    )).toBeUndefined();
    expect(queryClient.getQueryData(
      anyHarnessAgentLaunchOptionsKey(
        "https://gateway.test/v1/anyharness",
        "runtime-workspace-1",
        CACHE_SCOPE_KEY,
      ),
    )).toBeUndefined();
  });

  it("cancels an old materialization request before it can repopulate the cache", async () => {
    const queryClient = createQueryClient();
    const tracker = createCloudWorkspaceMaterializationCacheTracker({
      queryClient,
      cacheScopeKey: CACHE_SCOPE_KEY,
    });
    let aborted = false;
    const request = queryClient.fetchQuery({
      queryKey: anyHarnessSessionsKey(CACHE_SCOPE_KEY, LOGICAL_WORKSPACE_ID),
      queryFn: ({ signal }) => new Promise<never>((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          aborted = true;
          reject(signal.reason);
        });
      }),
    });

    await tracker.observe({ cloudWorkspaceId: CLOUD_WORKSPACE_ID, connection: connection({}) });
    await tracker.observe({ cloudWorkspaceId: CLOUD_WORKSPACE_ID, connection: connection({
      anyharnessWorkspaceId: "runtime-workspace-2",
    }) });

    await expect(request).rejects.toBeDefined();
    expect(aborted).toBe(true);
    expect(queryClient.getQueryData(
      anyHarnessSessionsKey(CACHE_SCOPE_KEY, LOGICAL_WORKSPACE_ID),
    )).toBeUndefined();
  });

  it("clears and refetches active workspace and launch-option queries", async () => {
    const queryClient = createQueryClient();
    const tracker = createCloudWorkspaceMaterializationCacheTracker({
      queryClient,
      cacheScopeKey: CACHE_SCOPE_KEY,
    });
    const sessionsKey = anyHarnessSessionsKey(CACHE_SCOPE_KEY, LOGICAL_WORKSPACE_ID);
    const launchOptionsKey = anyHarnessAgentLaunchOptionsKey(
      "https://gateway.test/v1/anyharness",
      "runtime-workspace-1",
      CACHE_SCOPE_KEY,
    );
    queryClient.setQueryData(sessionsKey, [{ id: "stale-session" }]);
    queryClient.setQueryData(launchOptionsKey, { source: "stale" });

    let resolveFreshSessions: (sessions: { id: string }[]) => void = () => {
      throw new Error("Expected the active query to refetch.");
    };
    const freshSessions = new Promise<{ id: string }[]>((resolve) => {
      resolveFreshSessions = resolve;
    });
    let resolveFreshLaunchOptions: (options: { source: string }) => void = () => {
      throw new Error("Expected the active launch-options query to refetch.");
    };
    const freshLaunchOptions = new Promise<{ source: string }>((resolve) => {
      resolveFreshLaunchOptions = resolve;
    });
    let sessionsFetchCount = 0;
    let launchOptionsFetchCount = 0;
    const sessionsObserver = new QueryObserver(queryClient, {
      queryKey: sessionsKey,
      queryFn: () => {
        sessionsFetchCount += 1;
        return freshSessions;
      },
      staleTime: Infinity,
    });
    const launchOptionsObserver = new QueryObserver(queryClient, {
      queryKey: launchOptionsKey,
      queryFn: () => {
        launchOptionsFetchCount += 1;
        return freshLaunchOptions;
      },
      staleTime: Infinity,
    });
    const unsubscribeSessions = sessionsObserver.subscribe(() => {});
    const unsubscribeLaunchOptions = launchOptionsObserver.subscribe(() => {});

    try {
      expect(sessionsObserver.getCurrentResult().data).toEqual([{ id: "stale-session" }]);
      expect(launchOptionsObserver.getCurrentResult().data).toEqual({ source: "stale" });
      expect(sessionsFetchCount).toBe(0);
      expect(launchOptionsFetchCount).toBe(0);

      await tracker.observe({ cloudWorkspaceId: CLOUD_WORKSPACE_ID, connection: connection({}) });
      const transition = tracker.observe({
        cloudWorkspaceId: CLOUD_WORKSPACE_ID,
        connection: connection({ runtimeGeneration: 2 }),
      });

      await vi.waitFor(() => {
        expect(sessionsFetchCount).toBe(1);
        expect(launchOptionsFetchCount).toBe(1);
      });
      expect(sessionsObserver.getCurrentResult().data).toBeUndefined();
      expect(launchOptionsObserver.getCurrentResult().data).toBeUndefined();

      resolveFreshSessions([{ id: "fresh-session" }]);
      resolveFreshLaunchOptions({ source: "fresh" });
      await transition;

      expect(sessionsObserver.getCurrentResult().data).toEqual([{ id: "fresh-session" }]);
      expect(launchOptionsObserver.getCurrentResult().data).toEqual({ source: "fresh" });
      expect(queryClient.getQueryData(sessionsKey)).toEqual([{ id: "fresh-session" }]);
      expect(queryClient.getQueryData(launchOptionsKey)).toEqual({ source: "fresh" });
    } finally {
      unsubscribeSessions();
      unsubscribeLaunchOptions();
    }
  });
});
