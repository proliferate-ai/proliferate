// @vitest-environment jsdom

import type { WorkflowRunProjectionV2, WorkflowRunV2, WorkflowRunsListResponseV2 } from "@anyharness/sdk";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnyHarnessRuntime } from "../context/AnyHarnessRuntime.js";
import {
  anyHarnessWorkflowRunKey,
  anyHarnessWorkflowRunsListKey,
} from "../lib/query-keys-workflow-runs.js";
import {
  WORKFLOW_RUN_ACTIVE_INTERVAL_MS,
  resolveWorkflowRunRefetchInterval,
  useWorkflowRunMutations,
  useWorkflowRunProjectionWriter,
} from "./workflow-runs.js";

const RUNTIME_URL = "http://runtime.test";

const mocks = vi.hoisted(() => ({
  approve: vi.fn(),
  flipType: vi.fn(),
  getRun: vi.fn(),
}));

vi.mock("../lib/client-cache.js", () => ({
  getAnyHarnessClient: () => ({
    workflowRunsV2: {
      approve: mocks.approve,
      flipType: mocks.flipType,
      getRun: mocks.getRun,
    },
  }),
}));

function run(overrides: Partial<WorkflowRunV2> = {}): WorkflowRunV2 {
  return {
    id: "run-1",
    invocationId: "invocation-1",
    definitionJson: "{}",
    argumentsJson: "{}",
    workspaceId: "workspace-1",
    status: "awaiting_human",
    currentNodeRowId: "node-1",
    failureCode: null,
    interruptionCode: null,
    createdAt: "2026-08-14T00:00:00.000Z",
    updatedAt: "2026-08-14T00:00:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

function projection(overrides: Partial<WorkflowRunV2> = {}): WorkflowRunProjectionV2 {
  return { run: run(overrides), nodes: [], docs: [] };
}

describe("useWorkflowRunMutations cache write-through", () => {
  afterEach(() => {
    cleanup();
    mocks.approve.mockReset();
    mocks.flipType.mockReset();
    mocks.getRun.mockReset();
  });

  it("writes the response projection into the run-detail cache via setQueryData, never invalidateQueries", async () => {
    const queryClient = createQueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const updated = projection({ status: "completed", currentNodeRowId: null });
    mocks.approve.mockResolvedValue(updated);

    const { result } = renderHook(() => useWorkflowRunMutations("run-1"), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.approve.mutateAsync({ nodeRowId: "node-1" });
    });

    expect(mocks.approve).toHaveBeenCalledWith("run-1", "node-1", undefined);
    expect(queryClient.getQueryData(anyHarnessWorkflowRunKey(RUNTIME_URL, RUNTIME_URL, "run-1")))
      .toBe(updated);
    expect(invalidate).not.toHaveBeenCalled();
    // The contract is: commands never need a follow-up read.
    expect(mocks.getRun).not.toHaveBeenCalled();
  });

  it("patches the matching row in a cached runs list without touching other rows", async () => {
    const queryClient = createQueryClient();
    const otherRun = run({ id: "run-2", status: "running" });
    const listKey = anyHarnessWorkflowRunsListKey(RUNTIME_URL, RUNTIME_URL, null);
    const seededList: WorkflowRunsListResponseV2 = { runs: [run(), otherRun] };
    queryClient.setQueryData(listKey, seededList);

    const updated = projection({ status: "completed", currentNodeRowId: null });
    mocks.approve.mockResolvedValue(updated);

    const { result } = renderHook(() => useWorkflowRunMutations("run-1"), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.approve.mutateAsync({ nodeRowId: "node-1" });
    });

    expect(queryClient.getQueryData<WorkflowRunsListResponseV2>(listKey)).toEqual({
      runs: [updated.run, otherRun],
    });
  });

  it("patches every cached runs list that contains the run, regardless of its workspace filter", async () => {
    const queryClient = createQueryClient();
    const allRunsKey = anyHarnessWorkflowRunsListKey(RUNTIME_URL, RUNTIME_URL, null);
    const workspaceScopedKey = anyHarnessWorkflowRunsListKey(RUNTIME_URL, RUNTIME_URL, "workspace-1");
    queryClient.setQueryData(allRunsKey, { runs: [run()] } satisfies WorkflowRunsListResponseV2);
    queryClient.setQueryData(
      workspaceScopedKey,
      { runs: [run()] } satisfies WorkflowRunsListResponseV2,
    );

    const updated = projection({ status: "failed", failureCode: "NODE_FAILED" });
    mocks.approve.mockResolvedValue(updated);

    const { result } = renderHook(() => useWorkflowRunMutations("run-1"), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.approve.mutateAsync({ nodeRowId: "node-1" });
    });

    expect(queryClient.getQueryData<WorkflowRunsListResponseV2>(allRunsKey)?.runs[0])
      .toEqual(updated.run);
    expect(queryClient.getQueryData<WorkflowRunsListResponseV2>(workspaceScopedKey)?.runs[0])
      .toEqual(updated.run);
  });

  it("inserts an absent run into a cached list, newest first", async () => {
    const queryClient = createQueryClient();
    const listKey = anyHarnessWorkflowRunsListKey(RUNTIME_URL, RUNTIME_URL, null);
    const older = run({ id: "run-9", createdAt: "2026-08-13T00:00:00.000Z" });
    const newer = run({ id: "run-8", createdAt: "2026-08-15T00:00:00.000Z" });
    queryClient.setQueryData(listKey, { runs: [newer, older] } satisfies WorkflowRunsListResponseV2);

    const updated = projection({ status: "completed" });
    mocks.approve.mockResolvedValue(updated);

    const { result } = renderHook(() => useWorkflowRunMutations("run-1"), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.approve.mutateAsync({ nodeRowId: "node-1" });
    });

    expect(queryClient.getQueryData<WorkflowRunsListResponseV2>(listKey)).toEqual({
      runs: [newer, updated.run, older],
    });
  });

  it("leaves a list scoped to another workspace untouched (negative control)", async () => {
    const queryClient = createQueryClient();
    const otherWorkspaceKey = anyHarnessWorkflowRunsListKey(
      RUNTIME_URL,
      RUNTIME_URL,
      "workspace-2",
    );
    const seededList: WorkflowRunsListResponseV2 = {
      runs: [run({ id: "run-9", workspaceId: "workspace-2" })],
    };
    queryClient.setQueryData(otherWorkspaceKey, seededList);

    const updated = projection({ status: "completed" });
    mocks.approve.mockResolvedValue(updated);

    const { result } = renderHook(() => useWorkflowRunMutations("run-1"), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.approve.mutateAsync({ nodeRowId: "node-1" });
    });

    expect(queryClient.getQueryData<WorkflowRunsListResponseV2>(otherWorkspaceKey))
      .toBe(seededList);
  });

  it("writes a projection obtained outside the mutations into the detail cache and every eligible list", () => {
    const queryClient = createQueryClient();
    const allRunsKey = anyHarnessWorkflowRunsListKey(RUNTIME_URL, RUNTIME_URL, null);
    const workspaceScopedKey = anyHarnessWorkflowRunsListKey(
      RUNTIME_URL,
      RUNTIME_URL,
      "workspace-1",
    );
    const otherWorkspaceKey = anyHarnessWorkflowRunsListKey(
      RUNTIME_URL,
      RUNTIME_URL,
      "workspace-2",
    );
    queryClient.setQueryData(allRunsKey, { runs: [] } satisfies WorkflowRunsListResponseV2);
    queryClient.setQueryData(workspaceScopedKey, { runs: [] } satisfies WorkflowRunsListResponseV2);
    const otherWorkspaceList: WorkflowRunsListResponseV2 = { runs: [] };
    queryClient.setQueryData(otherWorkspaceKey, otherWorkspaceList);

    const placed = projection({ status: "running" });
    const { result } = renderHook(() => useWorkflowRunProjectionWriter(), {
      wrapper: createWrapper(queryClient),
    });

    act(() => {
      result.current(placed);
    });

    expect(queryClient.getQueryData(anyHarnessWorkflowRunKey(RUNTIME_URL, RUNTIME_URL, "run-1")))
      .toBe(placed);
    expect(queryClient.getQueryData<WorkflowRunsListResponseV2>(allRunsKey)?.runs)
      .toEqual([placed.run]);
    expect(queryClient.getQueryData<WorkflowRunsListResponseV2>(workspaceScopedKey)?.runs)
      .toEqual([placed.run]);
    expect(queryClient.getQueryData<WorkflowRunsListResponseV2>(otherWorkspaceKey))
      .toBe(otherWorkspaceList);
  });

  it("routes flipType through the same write-through path", async () => {
    const queryClient = createQueryClient();
    const updated = projection({ status: "running" });
    mocks.flipType.mockResolvedValue(updated);

    const { result } = renderHook(() => useWorkflowRunMutations("run-1"), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.flipType.mutateAsync({
        nodeRowId: "node-1",
        request: { nodeType: "human_in_loop" },
      });
    });

    expect(mocks.flipType).toHaveBeenCalledWith(
      "run-1",
      "node-1",
      { nodeType: "human_in_loop" },
      undefined,
    );
    expect(queryClient.getQueryData(anyHarnessWorkflowRunKey(RUNTIME_URL, RUNTIME_URL, "run-1")))
      .toBe(updated);
  });
});

describe("resolveWorkflowRunRefetchInterval", () => {
  it("polls while the run is running or awaiting_human", () => {
    expect(resolveWorkflowRunRefetchInterval({ data: projection({ status: "running" }) }))
      .toBe(WORKFLOW_RUN_ACTIVE_INTERVAL_MS);
    expect(resolveWorkflowRunRefetchInterval({ data: projection({ status: "awaiting_human" }) }))
      .toBe(WORKFLOW_RUN_ACTIVE_INTERVAL_MS);
  });

  it("stops polling once the run is parked or terminal", () => {
    expect(resolveWorkflowRunRefetchInterval({ data: projection({ status: "interrupted" }) }))
      .toBe(false);
    expect(resolveWorkflowRunRefetchInterval({ data: projection({ status: "completed" }) }))
      .toBe(false);
    expect(resolveWorkflowRunRefetchInterval({ data: projection({ status: "failed" }) }))
      .toBe(false);
  });

  it("does not poll before any data has loaded", () => {
    expect(resolveWorkflowRunRefetchInterval({})).toBe(false);
  });
});

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <AnyHarnessRuntime runtimeUrl={RUNTIME_URL}>
          {children}
        </AnyHarnessRuntime>
      </QueryClientProvider>
    );
  };
}
