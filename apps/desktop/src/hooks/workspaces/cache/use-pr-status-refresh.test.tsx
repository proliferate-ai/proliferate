// @vitest-environment jsdom

import {
  anyHarnessRepoRootPullRequestsKey,
  anyHarnessWorktreesInventoryKey,
} from "@anyharness/sdk-react";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RepoPullRequestStatusesResult } from "@/lib/access/anyharness/pull-requests";
import {
  resetPrStatusRefreshForTests,
  scheduleRepoPrStatusRefresh,
} from "./use-pr-status-refresh";

const mocks = vi.hoisted(() => ({
  listRepoRootPullRequestStatuses: vi.fn(),
}));

vi.mock("@/lib/access/anyharness/pull-requests", () => ({
  listRepoRootPullRequestStatuses: mocks.listRepoRootPullRequestStatuses,
}));

const RUNTIME_URL = "http://runtime.test";
const KEY = anyHarnessRepoRootPullRequestsKey(RUNTIME_URL, "root-a");

function okResult(fetchedAt: string, headBranch = "feature"): RepoPullRequestStatusesResult {
  return {
    availability: "ok",
    entries: [{ headBranch, pullRequest: null }],
    fetchedAt,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  resetPrStatusRefreshForTests();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("scheduleRepoPrStatusRefresh", () => {
  it("debounces bursts into a single refresh=1 request", async () => {
    mocks.listRepoRootPullRequestStatuses.mockResolvedValue(okResult("2026-07-01T12:00:00.000Z"));
    const queryClient = new QueryClient();

    scheduleRepoPrStatusRefresh({ queryClient, runtimeUrl: RUNTIME_URL, repoRootId: "root-a" });
    scheduleRepoPrStatusRefresh({ queryClient, runtimeUrl: RUNTIME_URL, repoRootId: "root-a" });
    scheduleRepoPrStatusRefresh({ queryClient, runtimeUrl: RUNTIME_URL, repoRootId: "root-a" });

    expect(mocks.listRepoRootPullRequestStatuses).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);

    expect(mocks.listRepoRootPullRequestStatuses).toHaveBeenCalledTimes(1);
    expect(mocks.listRepoRootPullRequestStatuses).toHaveBeenCalledWith(
      { runtimeUrl: RUNTIME_URL },
      "root-a",
      { refresh: true },
    );
    expect(queryClient.getQueryData(KEY)).toEqual(okResult("2026-07-01T12:00:00.000Z"));
  });

  it("never replaces cached data whose fetchedAt is newer (monotonic guard)", async () => {
    const queryClient = new QueryClient();
    const newer = okResult("2026-07-01T13:00:00.000Z", "newer");
    queryClient.setQueryData(KEY, newer);
    mocks.listRepoRootPullRequestStatuses.mockResolvedValue(okResult("2026-07-01T12:00:00.000Z"));

    scheduleRepoPrStatusRefresh({ queryClient, runtimeUrl: RUNTIME_URL, repoRootId: "root-a" });
    await vi.advanceTimersByTimeAsync(300);

    expect(queryClient.getQueryData(KEY)).toEqual(newer);
  });

  it("replaces cached data with a fresher refresh result", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(KEY, okResult("2026-07-01T12:00:00.000Z", "older"));
    const fresher = okResult("2026-07-01T13:00:00.000Z", "fresher");
    mocks.listRepoRootPullRequestStatuses.mockResolvedValue(fresher);

    scheduleRepoPrStatusRefresh({ queryClient, runtimeUrl: RUNTIME_URL, repoRootId: "root-a" });
    await vi.advanceTimersByTimeAsync(300);

    expect(queryClient.getQueryData(KEY)).toEqual(fresher);
  });

  it("keeps good entries when the refresh lands on an outage", async () => {
    const queryClient = new QueryClient();
    const good = okResult("2026-07-01T12:00:00.000Z");
    queryClient.setQueryData(KEY, good);
    mocks.listRepoRootPullRequestStatuses.mockResolvedValue({
      availability: "error",
      entries: [],
      fetchedAt: null,
    });

    scheduleRepoPrStatusRefresh({ queryClient, runtimeUrl: RUNTIME_URL, repoRootId: "root-a" });
    await vi.advanceTimersByTimeAsync(300);

    expect(queryClient.getQueryData(KEY)).toEqual(good);
  });

  it("invalidates the worktree inventory alongside the PR refresh", async () => {
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    mocks.listRepoRootPullRequestStatuses.mockResolvedValue(okResult("2026-07-01T12:00:00.000Z"));

    scheduleRepoPrStatusRefresh({ queryClient, runtimeUrl: RUNTIME_URL, repoRootId: "root-a" });
    await vi.advanceTimersByTimeAsync(300);

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: anyHarnessWorktreesInventoryKey(RUNTIME_URL),
    });
  });

  it("skips scheduling without a runtime url or repo root id", async () => {
    const queryClient = new QueryClient();

    scheduleRepoPrStatusRefresh({ queryClient, runtimeUrl: " ", repoRootId: "root-a" });
    scheduleRepoPrStatusRefresh({ queryClient, runtimeUrl: RUNTIME_URL, repoRootId: "" });
    await vi.advanceTimersByTimeAsync(300);

    expect(mocks.listRepoRootPullRequestStatuses).not.toHaveBeenCalled();
  });
});
