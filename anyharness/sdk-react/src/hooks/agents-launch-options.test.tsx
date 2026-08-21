// @vitest-environment jsdom

import type { HarnessLaunchOptionsResponse } from "@anyharness/sdk";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnyHarnessRuntime } from "../context/AnyHarnessRuntime.js";
import {
  AGENT_LAUNCH_OPTIONS_PROBE_INTERVAL_MS,
  resolveAgentLaunchOptionsRefetchInterval,
  useAgentLaunchOptionsListQuery,
  useAgentLaunchOptionsQuery,
  useRefreshHarnessLaunchOptionsMutation,
} from "./agents.js";

const mocks = vi.hoisted(() => ({
  getLaunchOptions: vi.fn(),
  refreshLaunchOptions: vi.fn(),
}));

vi.mock("../lib/client-cache.js", () => ({
  getAnyHarnessClient: () => ({
    agents: {
      getLaunchOptions: (harnessKind: string, options: unknown) =>
        mocks.getLaunchOptions(harnessKind, options),
      refreshLaunchOptions: (harnessKind: string) =>
        mocks.refreshLaunchOptions(harnessKind),
    },
  }),
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.useRealTimers();
});

describe("launch-option convergence", () => {
  it("lands the observed revision with no user action", async () => {
    vi.useFakeTimers();
    mocks.getLaunchOptions
      .mockResolvedValueOnce(response({ revision: 1, state: "detecting", probePhase: "running" }))
      .mockResolvedValueOnce(response({ revision: 2, state: "observed", models: ["m-1"] }));

    const { result } = renderHook(
      () => useAgentLaunchOptionsQuery({ harnessKind: "claude" }),
      { wrapper: wrapper() },
    );

    await flushTimers(0);
    expect(mocks.getLaunchOptions).toHaveBeenCalledTimes(1);
    expect(result.current.data?.revision).toBe(1);
    expect(result.current.data?.state).toBe("detecting");

    await flushTimers(AGENT_LAUNCH_OPTIONS_PROBE_INTERVAL_MS);
    expect(mocks.getLaunchOptions).toHaveBeenCalledTimes(2);
    // The cache holds the new revision already; one more tick lets the
    // observer's batched notification reach the render.
    await flushTimers(1);
    expect(result.current.data?.revision).toBe(2);
    expect(result.current.data?.state).toBe("observed");
    expect(result.current.data?.options?.models).toHaveLength(1);

    // Landing is also stopping: the observed revision ends the loop.
    await flushTimers(AGENT_LAUNCH_OPTIONS_PROBE_INTERVAL_MS * 4);
    expect(mocks.getLaunchOptions).toHaveBeenCalledTimes(2);
  });

  it("does not poll a settled-unobserved harness", async () => {
    vi.useFakeTimers();
    mocks.getLaunchOptions.mockResolvedValue(
      response({ revision: 1, state: "detecting", probePhase: "idle" }),
    );

    renderHook(() => useAgentLaunchOptionsQuery({ harnessKind: "cursor" }), {
      wrapper: wrapper(),
    });

    await flushTimers(0);
    await flushTimers(AGENT_LAUNCH_OPTIONS_PROBE_INTERVAL_MS * 10);
    expect(mocks.getLaunchOptions).toHaveBeenCalledTimes(1);
  });

  it("keeps last-good data readable while a refresh is in flight", async () => {
    vi.useFakeTimers();
    mocks.getLaunchOptions
      .mockResolvedValueOnce(response({ revision: 3, state: "refreshing", models: ["m-old"] }))
      .mockResolvedValueOnce(response({ revision: 4, state: "observed", models: ["m-new"] }));

    const { result } = renderHook(
      () => useAgentLaunchOptionsQuery({ harnessKind: "claude" }),
      { wrapper: wrapper() },
    );

    await flushTimers(0);
    expect(result.current.data?.options?.models[0]?.id).toBe("m-old");

    await flushTimers(AGENT_LAUNCH_OPTIONS_PROBE_INTERVAL_MS);
    expect(mocks.getLaunchOptions).toHaveBeenCalledTimes(2);
    // The cache holds the new revision already; one more tick lets the
    // observer's batched notification reach the render.
    await flushTimers(1);
    expect(result.current.data?.options?.models[0]?.id).toBe("m-new");
  });

  it("stops on every terminal state, whatever the phase says", () => {
    const terminal = [
      "observed",
      "observed_empty",
      "last_good_after_failure",
      "failed_without_observation",
    ] as const;
    for (const state of terminal) {
      expect(
        resolveAgentLaunchOptionsRefetchInterval({ data: response({ state }) }),
      ).toBe(false);
      expect(
        resolveAgentLaunchOptionsRefetchInterval({
          data: response({ state, probePhase: "running" }),
        }),
      ).toBe(false);
    }

    for (const probePhase of ["idle", "backoff", undefined] as const) {
      expect(
        resolveAgentLaunchOptionsRefetchInterval({
          data: response({ state: "detecting", probePhase }),
        }),
      ).toBe(false);
    }
    for (const probePhase of ["queued", "running"] as const) {
      expect(
        resolveAgentLaunchOptionsRefetchInterval({
          data: response({ state: "detecting", probePhase }),
        }),
      ).toBe(AGENT_LAUNCH_OPTIONS_PROBE_INTERVAL_MS);
    }
    expect(
      resolveAgentLaunchOptionsRefetchInterval({ data: response({ state: "refreshing" }) }),
    ).toBe(AGENT_LAUNCH_OPTIONS_PROBE_INTERVAL_MS);
    expect(resolveAgentLaunchOptionsRefetchInterval({})).toBe(false);
  });

  it("rereads the harness after a failed refresh", async () => {
    mocks.getLaunchOptions
      .mockResolvedValueOnce(response({ revision: 5, state: "detecting", probePhase: "idle" }))
      .mockResolvedValueOnce(response({ revision: 6, state: "failed_without_observation" }));
    mocks.refreshLaunchOptions.mockRejectedValue(new Error("probe exploded"));

    const { result } = renderHook(
      () => ({
        query: useAgentLaunchOptionsQuery({ harnessKind: "claude" }),
        refresh: useRefreshHarnessLaunchOptionsMutation(),
      }),
      { wrapper: wrapper() },
    );

    await waitFor(() => expect(result.current.query.data?.revision).toBe(5));
    await act(async () => {
      await result.current.refresh.mutateAsync("claude").catch(() => undefined);
    });

    await waitFor(() => expect(mocks.getLaunchOptions).toHaveBeenCalledTimes(2));
    expect(result.current.query.data?.state).toBe("failed_without_observation");
  });

  it("keeps pending, error and data apart per kind, with stable references", async () => {
    mocks.getLaunchOptions.mockImplementation(async (harnessKind: string) => {
      if (harnessKind === "codex") throw new Error("no such harness here");
      return response({ revision: 7, state: "observed", models: ["m-1"] });
    });

    const { result, rerender } = renderHook(
      () => useAgentLaunchOptionsListQuery({ harnessKinds: ["claude", "codex"] }),
      { wrapper: wrapper() },
    );

    expect(result.current.map((entry) => entry.isPending)).toEqual([true, true]);
    expect(result.current.map((entry) => entry.harnessKind)).toEqual(["claude", "codex"]);

    await waitFor(() => expect(result.current.every((entry) => !entry.isPending)).toBe(true));
    expect(result.current[0]).toMatchObject({ harnessKind: "claude", isError: false });
    expect(result.current[0]?.data?.revision).toBe(7);
    expect(result.current[1]).toMatchObject({
      harnessKind: "codex",
      data: null,
      isError: true,
    });

    const settled = result.current;
    const claudeEntry = result.current[0];
    rerender();
    expect(result.current).toBe(settled);
    expect(result.current[0]).toBe(claudeEntry);
  });

  it("does not call a disabled fan-out pending", async () => {
    mocks.getLaunchOptions.mockResolvedValue(
      response({ revision: 1, state: "observed", models: ["m-1"] }),
    );

    const { result } = renderHook(
      () => useAgentLaunchOptionsListQuery({ harnessKinds: ["claude", "codex"] }),
      // No runtime URL: the queries are disabled, so nothing is in flight and
      // nothing will resolve them. React Query still calls that status "pending".
      { wrapper: wrapper("") },
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(mocks.getLaunchOptions).not.toHaveBeenCalled();
    expect(result.current.map((entry) => entry.isPending)).toEqual([false, false]);
    expect(result.current.map((entry) => entry.isError)).toEqual([false, false]);
    expect(result.current.map((entry) => entry.data)).toEqual([null, null]);
  });
});

function response({
  revision = 1,
  state,
  probePhase,
  models,
}: {
  revision?: number;
  state: HarnessLaunchOptionsResponse["state"];
  probePhase?: HarnessLaunchOptionsResponse["probePhase"];
  models?: string[];
}): HarnessLaunchOptionsResponse {
  return {
    harnessKind: "claude",
    basisRevision: "basis-1",
    revision,
    state,
    options: models
      ? {
        models: models.map((id) => ({ id, observedName: null, observedDescription: null })),
        controls: [],
        defaults: { modelId: models[0] ?? null, controlValues: {} },
      }
      : null,
    observedAt: models ? "2026-08-21T00:00:00Z" : null,
    probeAttemptedAt: "2026-08-21T00:00:00Z",
    probeFailureCode: null,
    readiness: "ready",
    ...(probePhase ? { probePhase } : {}),
  };
}

function wrapper(runtimeUrl = "http://local-runtime.test") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <AnyHarnessRuntime runtimeUrl={runtimeUrl}>
        {children}
      </AnyHarnessRuntime>
    </QueryClientProvider>
  );
}

async function flushTimers(milliseconds: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}
