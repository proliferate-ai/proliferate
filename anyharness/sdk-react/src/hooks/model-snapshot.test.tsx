// @vitest-environment jsdom

import { AnyHarnessError, type ModelSnapshotStatus } from "@anyharness/sdk";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnyHarnessRuntime } from "../context/AnyHarnessRuntime.js";
import {
  MODEL_SNAPSHOT_ACTIVE_INTERVAL_MS,
  resolveModelSnapshotRefetchInterval,
  useModelSnapshotStatusQuery,
} from "./model-snapshot.js";

const mocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
}));

vi.mock("../lib/client-cache.js", () => ({
  getAnyHarnessClient: (connection: unknown) => ({
    modelSnapshot: {
      getStatus: (kind: string, options: unknown) =>
        mocks.getStatus(connection, kind, options),
    },
  }),
}));

describe("model snapshot status polling", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("polls fast while the engine is queued or running, and stops once idle", async () => {
    vi.useFakeTimers();
    mocks.getStatus
      .mockResolvedValueOnce(status("idle"))
      .mockResolvedValueOnce(status("running"))
      .mockResolvedValueOnce(status("idle"));

    renderHook(() => useModelSnapshotStatusQuery("codex"), { wrapper: localWrapper() });
    await flushTimers(0);
    expect(mocks.getStatus).toHaveBeenCalledTimes(1);

    // idle: no automatic poke fires without one — a manual refresh mutation
    // is what moves this forward in the real app, so time alone should not
    // trigger another request while the engine stays idle.
    await flushTimers(MODEL_SNAPSHOT_ACTIVE_INTERVAL_MS * 10);
    expect(mocks.getStatus).toHaveBeenCalledTimes(1);
  });

  it("stops polling on a 404 (unknown agent kind)", () => {
    const notFound = new AnyHarnessError({
      type: "about:blank",
      title: "Not Found",
      status: 404,
    });
    const options = { refetchWhileActive: true };

    expect(resolveModelSnapshotRefetchInterval({ error: new Error("offline") }, options))
      .toBe(false);
    expect(resolveModelSnapshotRefetchInterval({}, options)).toBe(false);
    expect(resolveModelSnapshotRefetchInterval({
      data: status("running"),
      error: notFound,
    }, options)).toBe(false);
  });

  it("polls fast when the engine is queued or running", () => {
    const options = { refetchWhileActive: true };
    expect(resolveModelSnapshotRefetchInterval({ data: status("queued") }, options))
      .toBe(MODEL_SNAPSHOT_ACTIVE_INTERVAL_MS);
    expect(resolveModelSnapshotRefetchInterval({ data: status("running") }, options))
      .toBe(MODEL_SNAPSHOT_ACTIVE_INTERVAL_MS);
    expect(resolveModelSnapshotRefetchInterval({ data: status("idle") }, options))
      .toBe(false);
    expect(resolveModelSnapshotRefetchInterval({ data: status("backoff") }, options))
      .toBe(false);
  });

  it("never polls when refetchWhileActive is disabled", () => {
    expect(resolveModelSnapshotRefetchInterval(
      { data: status("running") },
      { refetchWhileActive: false },
    )).toBe(false);
  });

});

function status(state: ModelSnapshotStatus["state"]): ModelSnapshotStatus {
  return {
    agent: "codex",
    probeEngine: "owner",
    schemaVersion: 2,
    installIdentity: null,
    state,
    modelCount: 3,
    modeCount: 1,
  };
}

function queryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function localWrapper() {
  const client = queryClient();
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <AnyHarnessRuntime runtimeUrl="http://local-runtime.test">
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
