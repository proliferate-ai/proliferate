// @vitest-environment jsdom

import { createElement, type ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  AnyHarnessRuntime,
  anyHarnessCoworkManagedWorkspacesKey,
  anyHarnessGitStatusKey,
  readGitCacheForceEpoch,
  anyHarnessRuntimeKey,
  anyHarnessSessionReviewsKey,
  anyHarnessSessionSubagentsKey,
  anyHarnessWorkspaceSubagentsKey,
} from "@anyharness/sdk-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSessionStreamCache } from "#product/hooks/sessions/cache/use-session-stream-cache";
import {
  workspaceCollectionsScopeKey,
} from "#product/hooks/workspaces/cache/query-keys";

const CACHE_SCOPE_KEY = "desktop:test-user";
const RUNTIME_URL = "http://runtime.test";

vi.mock("#product/hooks/auth/facade/use-product-auth", () => ({
  useProductAuthUserId: () => "test-user",
}));

afterEach(cleanup);

describe("useSessionStreamCache", () => {
  it.each([
    { label: "workspace", workspaceId: "workspace-1" },
    { label: "null workspace", workspaceId: null },
  ])("invalidates the parent-session and $label subagent rosters", ({ workspaceId }) => {
    const { invalidateQueries, result } = renderStreamCache();

    act(() => {
      result.current.invalidateSessionSubagents({
        workspaceId,
        sessionId: "parent-session-1",
      });
    });

    expect(invalidateQueries.mock.calls.map(([filters]) => filters)).toEqual([
      {
        queryKey: anyHarnessSessionSubagentsKey(
          CACHE_SCOPE_KEY,
          workspaceId,
          "parent-session-1",
        ),
      },
      {
        queryKey: anyHarnessWorkspaceSubagentsKey(CACHE_SCOPE_KEY, workspaceId),
      },
    ]);
  });

  it("preserves invalidation keys and advances Git evidence after status settles", async () => {
    const { invalidateQueries, queryClient, result } = renderStreamCache();

    act(() => {
      result.current.invalidateWorkspaceCollections(RUNTIME_URL);
      result.current.invalidateCoworkManagedWorkspaces({
        runtimeUrl: RUNTIME_URL,
        sessionId: "parent-session-1",
      });
      result.current.invalidateSessionReviews({
        workspaceId: "workspace-1",
        parentSessionId: "parent-session-1",
      });
      result.current.invalidateGitStatus({ workspaceId: "workspace-1" });
    });

    expect(invalidateQueries.mock.calls.map(([filters]) => filters)).toEqual([
      { queryKey: workspaceCollectionsScopeKey(RUNTIME_URL) },
      {
        queryKey: anyHarnessCoworkManagedWorkspacesKey(
          RUNTIME_URL,
          "parent-session-1",
          CACHE_SCOPE_KEY,
        ),
      },
      {
        queryKey: [
          ...anyHarnessRuntimeKey(RUNTIME_URL, CACHE_SCOPE_KEY),
          "cowork",
          "sessions",
        ],
      },
      {
        queryKey: anyHarnessSessionReviewsKey(
          CACHE_SCOPE_KEY,
          "workspace-1",
          "parent-session-1",
        ),
      },
      {
        queryKey: anyHarnessGitStatusKey(CACHE_SCOPE_KEY, "workspace-1"),
      },
    ]);
    await waitFor(() => expect(
      readGitCacheForceEpoch(queryClient, CACHE_SCOPE_KEY, "workspace-1"),
    ).toBe(1));
  });
});

function renderStreamCache() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const invalidateQueries = vi
    .spyOn(queryClient, "invalidateQueries")
    .mockResolvedValue(undefined);
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    QueryClientProvider,
    { client: queryClient },
    createElement(AnyHarnessRuntime, {
      runtimeUrl: RUNTIME_URL,
      cacheScopeKey: CACHE_SCOPE_KEY,
      children,
    }),
  );
  const { result } = renderHook(() => useSessionStreamCache(), { wrapper });
  return { invalidateQueries, queryClient, result };
}
