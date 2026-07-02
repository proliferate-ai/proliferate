// @vitest-environment jsdom

import { AnyHarnessError } from "@anyharness/sdk";
import { anyHarnessRepoRootPullRequestsKey } from "@anyharness/sdk-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { useRepoPrStatuses } from "./use-repo-pr-statuses";

const mocks = vi.hoisted(() => ({
  listForRepoRoot: vi.fn(),
}));

vi.mock("@anyharness/sdk-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anyharness/sdk-react")>();
  return {
    ...actual,
    getAnyHarnessClient: () => ({
      pullRequests: { listForRepoRoot: mocks.listForRepoRoot },
    }),
  };
});

const RUNTIME_URL = "http://runtime.test";

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
}

function renderRepoPrStatuses(queryClient: QueryClient, repoRootIds: string[]) {
  function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  }
  return renderHook(({ ids }) => useRepoPrStatuses(ids), {
    wrapper: Wrapper,
    initialProps: { ids: repoRootIds },
  });
}

beforeEach(() => {
  useHarnessConnectionStore.setState({ runtimeUrl: RUNTIME_URL });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useRepoPrStatuses", () => {
  it("fetches each parameterized repo root under the shared key shape", async () => {
    mocks.listForRepoRoot.mockResolvedValue({
      entries: [{ headBranch: "feature", pullRequest: null }],
      fetchedAt: "2026-07-01T12:00:00.000Z",
    });
    const queryClient = makeQueryClient();

    const { result } = renderRepoPrStatuses(queryClient, ["root-b", "root-a", "root-a", " "]);

    await waitFor(() => {
      expect(result.current.availabilityByRepoRootId["root-a"]).toBe("ok");
      expect(result.current.availabilityByRepoRootId["root-b"]).toBe("ok");
    });

    expect(mocks.listForRepoRoot).toHaveBeenCalledTimes(2);
    expect(mocks.listForRepoRoot).toHaveBeenCalledWith(
      "root-a",
      { refresh: false },
      expect.anything(),
    );
    expect(result.current.entriesByRepoRootId["root-a"]).toEqual([
      { headBranch: "feature", pullRequest: null },
    ]);
    expect(result.current.fetchedAtByRepoRootId["root-a"]).toBe("2026-07-01T12:00:00.000Z");

    expect(queryClient.getQueryData(
      anyHarnessRepoRootPullRequestsKey(RUNTIME_URL, "root-a"),
    )).toEqual({
      availability: "ok",
      entries: [{ headBranch: "feature", pullRequest: null }],
      fetchedAt: "2026-07-01T12:00:00.000Z",
    });
  });

  it("maps a bare 404 (older daemon) to endpoint_missing without retrying", async () => {
    mocks.listForRepoRoot.mockRejectedValue(new AnyHarnessError({
      type: "about:blank",
      title: "Not Found",
      status: 404,
    }));
    const queryClient = makeQueryClient();

    const { result } = renderRepoPrStatuses(queryClient, ["root-a"]);

    await waitFor(() => {
      expect(result.current.availabilityByRepoRootId["root-a"]).toBe("endpoint_missing");
    });
    expect(result.current.entriesByRepoRootId["root-a"]).toEqual([]);
    expect(result.current.fetchedAtByRepoRootId["root-a"]).toBeNull();
    expect(mocks.listForRepoRoot).toHaveBeenCalledTimes(1);
  });

  it("maps a coded 404 (repo root gone) to a plain error", async () => {
    mocks.listForRepoRoot.mockRejectedValue(new AnyHarnessError({
      type: "about:blank",
      title: "Not Found",
      status: 404,
      code: "REPO_ROOT_NOT_FOUND",
    }));
    const queryClient = makeQueryClient();

    const { result } = renderRepoPrStatuses(queryClient, ["root-a"]);

    await waitFor(() => {
      expect(result.current.availabilityByRepoRootId["root-a"]).toBe("error");
    });
  });

  it("maps hosting error codes to typed availabilities", async () => {
    mocks.listForRepoRoot.mockRejectedValue(new AnyHarnessError({
      type: "about:blank",
      title: "gh auth required",
      status: 409,
      code: "HOSTING_GH_AUTH_REQUIRED",
    }));
    const queryClient = makeQueryClient();

    const { result } = renderRepoPrStatuses(queryClient, ["root-a"]);

    await waitFor(() => {
      expect(result.current.availabilityByRepoRootId["root-a"]).toBe("gh_auth_required");
    });
  });
});
