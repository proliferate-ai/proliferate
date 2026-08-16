import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MAX_WARM_WORKSPACE_SESSION_QUERIES,
  pinWorkspaceSessionsQueryWarm,
  resetWorkspaceSessionsWarmPinsForTest,
  warmWorkspaceSessionsPinCountForTest,
} from "#product/hooks/access/anyharness/workspaces/workspace-session-directory-keepalive";

function key(workspaceId: string): string[] {
  return ["sessions", workspaceId];
}

let queryClient: QueryClient;

beforeEach(() => {
  resetWorkspaceSessionsWarmPinsForTest();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});

afterEach(() => {
  resetWorkspaceSessionsWarmPinsForTest();
  queryClient.clear();
});

describe("workspace session directory keep-alive", () => {
  it("pins a seeded query so it survives garbage collection after seeding", () => {
    queryClient.setQueryData(key("ws-1"), [{ id: "s1" }]);
    pinWorkspaceSessionsQueryWarm(queryClient, key("ws-1"));

    // gcTime is 0, so an unpinned query would be collected once observerless.
    expect(queryClient.getQueryCache().find({ queryKey: key("ws-1") })).toBeDefined();
    expect(warmWorkspaceSessionsPinCountForTest()).toBe(1);
  });

  it("bounds warm pins to the LRU limit, evicting least-recently-pinned", () => {
    for (let i = 0; i < MAX_WARM_WORKSPACE_SESSION_QUERIES + 3; i += 1) {
      queryClient.setQueryData(key(`ws-${i}`), [{ id: `s${i}` }]);
      pinWorkspaceSessionsQueryWarm(queryClient, key(`ws-${i}`));
    }
    expect(warmWorkspaceSessionsPinCountForTest()).toBe(MAX_WARM_WORKSPACE_SESSION_QUERIES);
  });

  it("re-pinning refreshes recency instead of creating a second observer", () => {
    for (let i = 0; i < MAX_WARM_WORKSPACE_SESSION_QUERIES; i += 1) {
      queryClient.setQueryData(key(`ws-${i}`), [{ id: `s${i}` }]);
      pinWorkspaceSessionsQueryWarm(queryClient, key(`ws-${i}`));
    }
    // Touch the oldest so it becomes most-recent.
    pinWorkspaceSessionsQueryWarm(queryClient, key("ws-0"));
    // Add one more: the now-oldest (ws-1) is evicted, ws-0 survives.
    queryClient.setQueryData(key("ws-new"), [{ id: "sn" }]);
    pinWorkspaceSessionsQueryWarm(queryClient, key("ws-new"));

    expect(warmWorkspaceSessionsPinCountForTest()).toBe(MAX_WARM_WORKSPACE_SESSION_QUERIES);
    // ws-0 was re-pinned so it must still be observed (not garbage-collected).
    expect(queryClient.getQueryCache().find({ queryKey: key("ws-0") })?.getObserversCount())
      .toBeGreaterThan(0);
    expect(queryClient.getQueryCache().find({ queryKey: key("ws-1") })?.getObserversCount() ?? 0)
      .toBe(0);
  });
});
