// @vitest-environment jsdom

import { AnyHarnessError, type ReconcileAgentsResponse } from "@anyharness/sdk";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnyHarnessRuntime } from "../context/AnyHarnessRuntime.js";
import { AnyHarnessWorkspace } from "../context/AnyHarnessWorkspace.js";
import {
  AGENT_RECONCILE_ACTIVE_INTERVAL_MS,
  AGENT_RECONCILE_DISCOVERY_INTERVAL_MS,
  AGENT_RECONCILE_DOWNLOAD_INTERVAL_MS,
  resolveAgentReconcileRefetchInterval,
  useAgentReconcileStatusQuery,
  useWorkspaceAgentReconcileStatusQuery,
} from "./agents.js";

const mocks = vi.hoisted(() => ({
  getReconcileStatus: vi.fn(),
}));

vi.mock("../lib/client-cache.js", () => ({
  getAnyHarnessClient: (connection: unknown) => ({
    agents: {
      getReconcileStatus: (options: unknown) =>
        mocks.getReconcileStatus(connection, options),
    },
  }),
}));

describe("agent reconcile discovery polling", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("discovers local idle to running and changes cadence by phase", async () => {
    vi.useFakeTimers();
    mocks.getReconcileStatus
      .mockResolvedValueOnce(snapshot("idle"))
      .mockResolvedValueOnce(snapshot("running"))
      .mockResolvedValueOnce(snapshot("running", "downloading"))
      .mockResolvedValueOnce(snapshot("completed"))
      .mockResolvedValueOnce(snapshot("idle"));

    renderHook(() => useAgentReconcileStatusQuery({ discoverWhileIdle: true }), {
      wrapper: localWrapper(),
    });
    await flushTimers(0);
    expect(mocks.getReconcileStatus).toHaveBeenCalledTimes(1);

    await flushTimers(AGENT_RECONCILE_DISCOVERY_INTERVAL_MS - 1);
    expect(mocks.getReconcileStatus).toHaveBeenCalledTimes(1);
    await flushTimers(1);
    expect(mocks.getReconcileStatus).toHaveBeenCalledTimes(2);

    await flushTimers(AGENT_RECONCILE_ACTIVE_INTERVAL_MS);
    expect(mocks.getReconcileStatus).toHaveBeenCalledTimes(3);
    await flushTimers(AGENT_RECONCILE_DOWNLOAD_INTERVAL_MS);
    expect(mocks.getReconcileStatus).toHaveBeenCalledTimes(4);
    await flushTimers(AGENT_RECONCILE_DISCOVERY_INTERVAL_MS);
    expect(mocks.getReconcileStatus).toHaveBeenCalledTimes(5);
  });

  it("discovers a workspace runtime reconcile that starts after idle", async () => {
    vi.useFakeTimers();
    mocks.getReconcileStatus
      .mockResolvedValueOnce(snapshot("idle"))
      .mockResolvedValueOnce(snapshot("running"));

    renderHook(
      () => useWorkspaceAgentReconcileStatusQuery({ discoverWhileIdle: true }),
      { wrapper: workspaceWrapper() },
    );
    await flushTimers(0);
    expect(mocks.getReconcileStatus).toHaveBeenCalledTimes(1);

    await flushTimers(AGENT_RECONCILE_DISCOVERY_INTERVAL_MS);
    expect(mocks.getReconcileStatus).toHaveBeenCalledTimes(2);
    expect(mocks.getReconcileStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({
        runtimeUrl: "https://workspace-runtime.test",
        anyharnessWorkspaceId: "runtime-workspace-1",
      }),
      expect.anything(),
    );
  });

  it("retries transient discovery failures but stops after a 404", () => {
    const notFound = new AnyHarnessError({
      type: "about:blank",
      title: "Not Found",
      status: 404,
    });
    const options = { discoverWhileIdle: true, refetchWhileActive: true };

    expect(resolveAgentReconcileRefetchInterval({ error: new Error("offline") }, options))
      .toBe(AGENT_RECONCILE_DISCOVERY_INTERVAL_MS);
    expect(resolveAgentReconcileRefetchInterval({}, options))
      .toBe(AGENT_RECONCILE_DISCOVERY_INTERVAL_MS);
    expect(resolveAgentReconcileRefetchInterval({ error: notFound }, options)).toBe(false);
    expect(resolveAgentReconcileRefetchInterval({
      data: snapshot("idle"),
      error: notFound,
    }, options)).toBe(false);
    expect(resolveAgentReconcileRefetchInterval({
      data: snapshot("running", "downloading"),
      error: notFound,
    }, options)).toBe(false);
  });
});

function snapshot(
  status: ReconcileAgentsResponse["status"],
  phase?: "downloading",
): ReconcileAgentsResponse {
  return {
    jobId: status === "idle" ? null : "job-1",
    reinstall: false,
    results: [],
    status,
    progress: phase ? {
      completedComponents: 0,
      components: [{
        agent: "codex",
        downloadedBytes: 1,
        downloadSizeBytes: 2,
        phase,
        role: "native_cli",
      }],
      downloadedBytes: 1,
      downloadSizeBytes: 2,
      totalComponents: 1,
    } : null,
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

function workspaceWrapper() {
  const client = queryClient();
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <AnyHarnessRuntime runtimeUrl={null} cacheScopeKey="actor:user-1">
        <AnyHarnessWorkspace
          workspaceId="cloud:workspace-1"
          resolveConnection={async () => ({
            runtimeUrl: "https://workspace-runtime.test",
            anyharnessWorkspaceId: "runtime-workspace-1",
          })}
        >
          {children}
        </AnyHarnessWorkspace>
      </AnyHarnessRuntime>
    </QueryClientProvider>
  );
}

async function flushTimers(milliseconds: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}
