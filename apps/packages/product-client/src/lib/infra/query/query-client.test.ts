import { AnyHarnessError } from "@anyharness/sdk";
import { ProliferateClientError } from "@proliferate/cloud-sdk";
import { CancelledError, type QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import {
  createAppQueryClient,
  hashAppQueryKey,
  shouldCaptureAppMutationError,
  shouldCaptureAppQueryError,
} from "#product/lib/infra/query/query-client";

describe("hashAppQueryKey", () => {
  it("hashes plain query keys with sorted object fields", () => {
    expect(hashAppQueryKey(["cloud", { repo: "b", owner: "a" }])).toBe(
      '["cloud",{"owner":"a","repo":"b"}]',
    );
  });

  it("does not recurse forever on cyclic query keys", () => {
    const value: { id: string; self?: unknown } = { id: "cycle" };
    value.self = value;

    expect(hashAppQueryKey(["workspace", value])).toBe(
      '["workspace",{"id":"cycle","self":"[Circular]"}]',
    );
  });

  it("summarizes non-plain objects instead of traversing browser objects", () => {
    const event = new Event("click");

    expect(hashAppQueryKey(["event", event])).toBe('["event","[Event]"]');
  });
});

async function runFailingQuery(
  client: QueryClient,
  queryKey: readonly unknown[],
  error: Error,
  meta?: { telemetryHandled: true },
): Promise<void> {
  await expect(client.fetchQuery({
    queryKey,
    queryFn: async () => {
      throw error;
    },
    retry: false,
    meta,
  })).rejects.toBe(error);
}

describe("createAppQueryClient query telemetry", () => {
  it.each([
    ["AbortError", new DOMException("Aborted", "AbortError")],
    ["401 auth gate", new ProliferateClientError("Signed out", 401)],
    ["403 permission gate", new ProliferateClientError("Forbidden", 403)],
    ["GitHub App reconnect state", new ProliferateClientError(
      "Reconnect GitHub App",
      409,
      "github_app_authorization_expired",
    )],
    ["GitHub App installation state", new ProliferateClientError(
      "Install GitHub App",
      409,
      "github_app_installation_required",
    )],
    ["AnyHarness hosting availability", new AnyHarnessError({
      type: "about:blank",
      title: "GitHub CLI is not installed",
      status: 400,
      code: "HOSTING_GH_NOT_INSTALLED",
    })],
  ])("does not capture %s while preserving query error state", async (_name, error) => {
    const captureException = vi.fn();
    const client = createAppQueryClient({ captureException });
    const queryKey = ["expected-state", _name];

    await runFailingQuery(client, queryKey, error);

    expect(captureException).not.toHaveBeenCalled();
    expect(client.getQueryState(queryKey)).toMatchObject({
      status: "error",
      error,
    });
  });

  it("does not capture TanStack cancellation", () => {
    expect(shouldCaptureAppQueryError(new CancelledError())).toBe(false);
  });

  it.each([
    ["generic 400", new ProliferateClientError("Bad Request", 400)],
    ["generic Not Found", new ProliferateClientError("Not Found", 404)],
    ["generic 409", new ProliferateClientError("Conflict", 409)],
    ["generic 422", new ProliferateClientError("Unprocessable", 422)],
    ["unrecognized coded 409", new ProliferateClientError(
      "Workspace state conflict",
      409,
      "workspace_state_conflict",
    )],
    ["5xx request failure", new ProliferateClientError("Unavailable", 503)],
    ["coded AnyHarness request failure", new AnyHarnessError({
      type: "about:blank",
      title: "Pull request lookup failed",
      status: 400,
      code: "HOSTING_PR_VIEW_FAILED",
    })],
    ["network failure", new TypeError("Failed to fetch")],
    ["unknown programming failure", new Error("Invariant failed")],
    [
      "configuration-like unknown failure",
      Object.assign(new Error("Missing configuration invariant"), {
        code: "INTERNAL_STATE_INVALID",
      }),
    ],
  ])("captures %s", async (_name, error) => {
    const captureException = vi.fn();
    const client = createAppQueryClient({ captureException });
    const queryKey = ["capture", _name];

    await runFailingQuery(client, queryKey, error);

    expect(captureException).toHaveBeenCalledExactlyOnceWith(error, {
      tags: {
        action: "query_error",
        domain: "react_query",
      },
      extras: {
        query_hash: hashAppQueryKey(queryKey),
      },
    });
  });

  it("preserves the explicit telemetryHandled query override", async () => {
    const captureException = vi.fn();
    const client = createAppQueryClient({ captureException });

    await runFailingQuery(
      client,
      ["handled"],
      new Error("Captured by the query owner"),
      { telemetryHandled: true },
    );

    expect(captureException).not.toHaveBeenCalled();
  });

  it("keeps the existing query retry and UI defaults", () => {
    const client = createAppQueryClient({ captureException: vi.fn() });

    expect(client.getDefaultOptions().queries).toMatchObject({
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    });
  });

  it("leaves mutation telemetry behavior unchanged", async () => {
    const captureException = vi.fn();
    const client = createAppQueryClient({ captureException });
    const error = new ProliferateClientError("Forbidden", 403);
    const mutationKey = ["mutation-permission-gate"];
    const mutation = client.getMutationCache().build(client, {
      mutationKey,
      mutationFn: async () => {
        throw error;
      },
      retry: false,
    });

    await expect(mutation.execute(undefined)).rejects.toBe(error);

    expect(captureException).toHaveBeenCalledExactlyOnceWith(error, {
      tags: {
        action: "mutation_error",
        domain: "react_query",
      },
      extras: {
        mutation_key: hashAppQueryKey(mutationKey),
      },
    });
  });

  it.each([
    "REPO_ROOT_NOT_GIT_REPO",
    "REPO_ROOT_WORKTREE_UNSUPPORTED",
    "REPO_WORKSPACE_NOT_GIT_REPO",
    "REPO_WORKSPACE_WORKTREE_UNSUPPORTED",
  ])("does not capture expected repository mutation validation %s", async (code) => {
    const captureException = vi.fn();
    const client = createAppQueryClient({ captureException });
    const error = new AnyHarnessError({
      type: "about:blank",
      title: "Repository selection rejected",
      status: 400,
      code,
    });
    const mutation = client.getMutationCache().build(client, {
      mutationKey: ["resolve-repository"],
      mutationFn: async () => {
        throw error;
      },
      retry: false,
    });

    await expect(mutation.execute(undefined)).rejects.toBe(error);

    expect(shouldCaptureAppMutationError(error)).toBe(false);
    expect(captureException).not.toHaveBeenCalled();
  });
});
