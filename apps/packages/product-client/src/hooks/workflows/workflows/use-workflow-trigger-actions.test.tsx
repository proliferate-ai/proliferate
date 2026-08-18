// @vitest-environment jsdom

import { AnyHarnessError } from "@anyharness/sdk";
import type {
  Workspace,
  WorkflowRunProjectionV2,
  WorkflowRunV2,
} from "@anyharness/sdk";
import {
  AnyHarnessRuntime,
  anyHarnessWorkflowRunKey,
  anyHarnessWorkflowRunsListKey,
} from "@anyharness/sdk-react";
import type { WorkflowRunsListResponseV2 } from "@anyharness/sdk";
import type { WorkflowInvocationV2 } from "@proliferate/cloud-sdk";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowRuntimeNotConnectedError } from "#product/lib/domain/workflows/workflow-trigger-failure";
import {
  resetRendererDiagnosticsSinkForTest,
  setRendererDiagnosticsSink,
  type RendererDiagnosticInput,
} from "#product/lib/infra/diagnostics/renderer-diagnostics-port";
import { prevalidateRendererDiagnostic } from "@/lib/infra/diagnostics/renderer-diagnostic-prevalidate";
import type { TriggerCourierInput } from "#product/lib/workflows/trigger/trigger-courier";
import { useHarnessConnectionStore } from "#product/stores/sessions/harness-connection-store";
import {
  useWorkflowTriggerActions,
  type WorkflowTriggerLaunch,
} from "./use-workflow-trigger-actions";

const RUNTIME_URL = "http://runtime.test";

/** The workspace `PUT /v1/workflow-runs/{id}` materializes for the run. */
const PLACED_WORKSPACE = { id: "workspace-1" } as unknown as Workspace;

const planes = vi.hoisted(() => ({
  putInvocation: vi.fn(),
  putRun: vi.fn(),
  getWorkspace: vi.fn(),
  invalidateCollections: vi.fn(),
}));

vi.mock("#product/hooks/access/cloud/workflows/use-workflow-trigger-access", () => ({
  useWorkflowInvocationV2MutationsAccess: () => ({
    putWorkflowInvocationV2: planes.putInvocation,
  }),
}));

vi.mock("#product/hooks/access/anyharness/workflows/use-workflow-run-put", () => ({
  useWorkflowRunPut: () => planes.putRun,
}));

vi.mock("#product/lib/access/anyharness/workspaces", () => ({
  getWorkspace: planes.getWorkspace,
}));

vi.mock("#product/hooks/workspaces/cache/use-workspace-collections-invalidation", () => ({
  useWorkspaceCollectionsInvalidationActions: () => ({
    invalidateWorkspaceCollectionsForRuntime: planes.invalidateCollections,
  }),
}));

const INPUT: TriggerCourierInput = {
  workflowDefinitionId: "definition-1",
  arguments: { ticket: "PRO-1" },
  placement: { repoConfigId: "repo-1", mode: "worktree" },
};

beforeEach(() => {
  let minted = 0;
  // The courier mints its two ids here; a counter makes "same identity" and
  // "fresh identity" observable in the plane calls.
  vi.stubGlobal("crypto", { randomUUID: () => `id-${(minted += 1)}` });
  planes.putInvocation.mockImplementation(async (
    input: { invocationId: string },
  ) => invocation(input.invocationId));
  planes.putRun.mockImplementation(async (runId: string) => projection(runId));
  planes.getWorkspace.mockImplementation(async () => PLACED_WORKSPACE);
  planes.invalidateCollections.mockResolvedValue(undefined);
  useHarnessConnectionStore.getState().setRuntimeUrl(RUNTIME_URL);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  planes.putInvocation.mockReset();
  planes.putRun.mockReset();
  planes.getWorkspace.mockReset();
  planes.invalidateCollections.mockReset();
  useHarnessConnectionStore.getState().resetConnectionState();
});

describe("useWorkflowTriggerActions retry identity", () => {
  it("replays the same ids when the retry submits an unchanged input", async () => {
    planes.putRun.mockRejectedValueOnce(runtimeError("WORKFLOW_WORKSPACE_MATERIALIZATION_FAILED"));
    const { result } = renderTriggerActions();

    await act(async () => {
      await result.current.triggerRun(INPUT);
    });
    await act(async () => {
      await result.current.triggerRun(INPUT);
    });

    expect(invocationIds()).toEqual(["id-1", "id-1"]);
    expect(runIds()).toEqual(["id-2", "id-2"]);
  });

  it("mints a fresh identity when the repo pick changes after a failure", async () => {
    planes.putRun.mockRejectedValueOnce(runtimeError("WORKFLOW_WORKSPACE_MATERIALIZATION_FAILED"));
    const { result } = renderTriggerActions();

    await act(async () => {
      await result.current.triggerRun(INPUT);
    });
    await act(async () => {
      await result.current.triggerRun({
        ...INPUT,
        placement: { repoConfigId: "repo-2", mode: "worktree" },
      });
    });

    // A replay of id-1 with a different body is what the control plane 409s.
    expect(invocationIds()).toEqual(["id-1", "id-3"]);
    expect(runIds()).toEqual(["id-2", "id-4"]);
  });

  it("mints a fresh identity when an input value changes after a failure", async () => {
    planes.putInvocation.mockRejectedValueOnce(cloudError("invalid_workflow_invocation"));
    const { result } = renderTriggerActions();

    await act(async () => {
      await result.current.triggerRun(INPUT);
    });
    await act(async () => {
      await result.current.triggerRun({ ...INPUT, arguments: { ticket: "PRO-2" } });
    });

    expect(invocationIds()).toEqual(["id-1", "id-3"]);
  });

  it("drops the ids after a success, so the next submit is its own run", async () => {
    const { result } = renderTriggerActions();

    await act(async () => {
      await result.current.triggerRun(INPUT);
    });
    await act(async () => {
      await result.current.triggerRun(INPUT);
    });

    expect(invocationIds()).toEqual(["id-1", "id-3"]);
  });
});

describe("useWorkflowTriggerActions failure copy", () => {
  it("surfaces the runtime code's own sentence", async () => {
    planes.putRun.mockRejectedValueOnce(runtimeError("WORKFLOW_SNAPSHOT_INVALID"));
    const { result } = renderTriggerActions();

    await act(async () => {
      await result.current.triggerRun(INPUT);
    });

    expect(result.current.error).toBe(
      "This workflow cannot run as saved. Open it in the editor, fix the steps it reports, then start it again.",
    );
  });

  it("names the disconnected runtime instead of a refresh sentence", async () => {
    planes.putRun.mockRejectedValueOnce(new WorkflowRuntimeNotConnectedError());
    const { result } = renderTriggerActions();

    await act(async () => {
      await result.current.triggerRun(INPUT);
    });

    expect(result.current.error).toBe(
      "The local runtime is not connected. Reconnect it, then start this run again.",
    );
  });

  it("surfaces the control plane's conflict sentence", async () => {
    planes.putInvocation.mockRejectedValueOnce(cloudError("workflow_invocation_conflict"));
    const { result } = renderTriggerActions();

    await act(async () => {
      await result.current.triggerRun(INPUT);
    });

    expect(result.current.error).toBe(
      "That run was already started with different inputs. Start it again to place a new run.",
    );
  });
});

describe("useWorkflowTriggerActions placed workspace", () => {
  it("hands the launch the workspace record the run PUT just materialized", async () => {
    const onLaunched = vi.fn();
    const { result } = renderTriggerActions(createQueryClient(), onLaunched);

    await act(async () => {
      await result.current.triggerRun(INPUT);
    });

    expect(planes.getWorkspace).toHaveBeenCalledWith({ runtimeUrl: RUNTIME_URL }, "workspace-1");
    // Selection reads the collections cache, which was filled before this
    // workspace existed; the record is what keeps the launch off the
    // "Workspace not found." path.
    expect(onLaunched).toHaveBeenCalledWith({
      runId: "id-2",
      workspaceId: "workspace-1",
      workspace: PLACED_WORKSPACE,
    });
  });

  it("retries a refused read-back rather than launching without the record", async () => {
    // Refreshing the collections cache cannot rescue this: the navigation
    // about to happen reads the snapshot selection already rendered with. The
    // record is the only hint, so one refusal must not be the end of it.
    planes.getWorkspace.mockRejectedValueOnce(new Error("offline"));
    const onLaunched = vi.fn();
    const { result } = renderTriggerActions(createQueryClient(), onLaunched);

    await act(async () => {
      await result.current.triggerRun(INPUT);
    });

    expect(planes.getWorkspace).toHaveBeenCalledTimes(2);
    expect(onLaunched).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "workspace-1", workspace: PLACED_WORKSPACE }),
    );
  });

  it("waits for the refreshed collections when no read-back answered", async () => {
    // Selection resolves a workspace either from the hint or from the
    // collections snapshot it reads when called. With no hint left, the
    // refreshed snapshot is the only thing standing between this launch and
    // "Workspace not found.", so navigation has to wait for it.
    planes.getWorkspace.mockRejectedValue(new Error("offline"));
    let releaseRefresh: (() => void) | null = null;
    planes.invalidateCollections.mockImplementation(() => new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    }));
    const onLaunched = vi.fn();
    const { result } = renderTriggerActions(createQueryClient(), onLaunched);

    let launched: Promise<unknown> | undefined;
    await act(async () => {
      launched = result.current.triggerRun(INPUT);
      await vi.waitFor(() => expect(planes.invalidateCollections).toHaveBeenCalled());
    });
    expect(onLaunched).not.toHaveBeenCalled();

    await act(async () => {
      releaseRefresh?.();
      await launched;
    });
    expect(onLaunched).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "workspace-1", workspace: null }),
    );
  });

  it("reads the workspace once more when the refresh it fell back to refused", async () => {
    // The two resolvers are the hint and the refreshed collections snapshot.
    // A rejected refresh leaves selection the same stale snapshot it already
    // held, so handing it no hint on top of that is a launch heading straight
    // for "Workspace not found." — one last read is what is left to try.
    planes.getWorkspace
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce(new Error("offline"));
    planes.invalidateCollections.mockRejectedValue(new Error("refresh failed"));
    const onLaunched = vi.fn();
    const { result } = renderTriggerActions(createQueryClient(), onLaunched);

    await act(async () => {
      await result.current.triggerRun(INPUT);
    });

    expect(planes.getWorkspace).toHaveBeenCalledTimes(4);
    expect(onLaunched).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "workspace-1", workspace: PLACED_WORKSPACE }),
    );
  });

  it("still navigates when every read-back attempt fails", async () => {
    planes.getWorkspace.mockRejectedValue(new Error("offline"));
    const onLaunched = vi.fn();
    const { result } = renderTriggerActions(createQueryClient(), onLaunched);

    await act(async () => {
      await result.current.triggerRun(INPUT);
    });

    // Bounded: the run exists and the projection is written, so the launch is
    // reported either way — the surface's own error toast owns what follows.
    expect(planes.getWorkspace).toHaveBeenCalledTimes(3);
    expect(onLaunched).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "workspace-1", workspace: null }),
    );
  });
});

describe("useWorkflowTriggerActions cache write-through", () => {
  it("puts the placed run in the run-detail cache and in every cached runs list", async () => {
    const queryClient = createQueryClient();
    const listKey = anyHarnessWorkflowRunsListKey(RUNTIME_URL, RUNTIME_URL, null);
    queryClient.setQueryData(listKey, { runs: [] } satisfies WorkflowRunsListResponseV2);
    const { result } = renderTriggerActions(queryClient);

    await act(async () => {
      await result.current.triggerRun(INPUT);
    });

    expect(queryClient.getQueryData<WorkflowRunsListResponseV2>(listKey)?.runs)
      .toEqual([run("id-2")]);
    expect(queryClient.getQueryData<WorkflowRunProjectionV2>(
      anyHarnessWorkflowRunKey(RUNTIME_URL, RUNTIME_URL, "id-2"),
    )).toEqual(projection("id-2"));
  });
});

describe("useWorkflowTriggerActions diagnostics", () => {
  const records: RendererDiagnosticInput[] = [];

  beforeEach(() => {
    records.length = 0;
    setRendererDiagnosticsSink({ emit: (input) => records.push(input) });
  });

  afterEach(() => {
    resetRendererDiagnosticsSinkForTest();
  });

  it("emits a launch_submitted milestone that survives the desktop prevalidator", async () => {
    const { result } = renderTriggerActions();

    await act(async () => {
      await result.current.triggerRun(INPUT);
    });

    const record = records.find(
      (input) => input.name === "renderer.workflows.launch_submitted",
    );
    expect(record).toBeDefined();
    const accepted = prevalidateRendererDiagnostic(record!);
    expect(accepted).not.toBeNull();
    expect(accepted!.correlation.workflowId).toBe("id-2");
  });

  it("emits a classified, correlated launch_failed that survives the desktop prevalidator", async () => {
    planes.putRun.mockRejectedValueOnce(runtimeError("WORKFLOW_PLACEMENT_CONFLICT"));
    const { result } = renderTriggerActions();

    await act(async () => {
      await result.current.triggerRun(INPUT);
    });

    const record = records.find(
      (input) => input.name === "renderer.workflows.launch_failed",
    );
    expect(record).toBeDefined();
    const accepted = prevalidateRendererDiagnostic(record!);
    expect(accepted).not.toBeNull();
    expect(accepted!.errorClassification).toBe("trigger_run");
    expect(accepted!.correlation.workflowId).toBe("id-2");
  });

  it("negative control: an uppercase classification voids the whole record", async () => {
    planes.putRun.mockRejectedValueOnce(runtimeError("WORKFLOW_PLACEMENT_CONFLICT"));
    const { result } = renderTriggerActions();

    await act(async () => {
      await result.current.triggerRun(INPUT);
    });

    const record = records.find(
      (input) => input.name === "renderer.workflows.launch_failed",
    );
    expect(
      prevalidateRendererDiagnostic({
        ...record!,
        errorClassification: "WORKFLOW_PLACEMENT_CONFLICT",
      }),
    ).toBeNull();
  });
});

function renderTriggerActions(
  queryClient: QueryClient = createQueryClient(),
  onLaunched?: (launch: WorkflowTriggerLaunch) => void,
) {
  return renderHook(
    () => useWorkflowTriggerActions({ authCacheScope: "user-1", onLaunched }),
    { wrapper: createWrapper(queryClient) },
  );
}

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

function invocationIds(): string[] {
  return planes.putInvocation.mock.calls.map(
    ([input]: [{ invocationId: string }]) => input.invocationId,
  );
}

function runIds(): string[] {
  return planes.putRun.mock.calls.map(([runId]: [string]) => runId);
}

function invocation(invocationId: string): WorkflowInvocationV2 {
  return {
    id: invocationId,
    schemaVersion: 2,
    workflowDefinitionId: INPUT.workflowDefinitionId,
    definitionRevision: 1,
    title: "Triage",
    description: "",
    definition: { schemaVersion: 2, nodes: [] },
    arguments: INPUT.arguments,
    placement: INPUT.placement,
    createdAt: "2026-08-14T00:00:00.000Z",
  };
}

function run(runId: string): WorkflowRunV2 {
  return {
    id: runId,
    invocationId: "id-1",
    definitionJson: "{}",
    argumentsJson: "{}",
    workspaceId: "workspace-1",
    status: "running",
    currentNodeRowId: null,
    failureCode: null,
    interruptionCode: null,
    createdAt: "2026-08-14T00:00:00.000Z",
    updatedAt: "2026-08-14T00:00:00.000Z",
    completedAt: null,
  };
}

function projection(runId: string): WorkflowRunProjectionV2 {
  return { run: run(runId), nodes: [], docs: [] };
}

function runtimeError(code: string): AnyHarnessError {
  return new AnyHarnessError({
    type: "about:blank",
    title: "Request failed",
    status: 500,
    code,
  });
}

/** The control plane's envelope: status and code at the top level. */
function cloudError(code: string): Error {
  return Object.assign(new Error("Request failed"), { status: 409, code });
}
