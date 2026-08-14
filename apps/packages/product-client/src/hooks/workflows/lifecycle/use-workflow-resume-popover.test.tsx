// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { WorkflowRunProjectionV2, WorkflowRunV2 } from "@anyharness/sdk";
import { AnyHarnessRuntime, anyHarnessWorkflowRunKey } from "@anyharness/sdk-react";
import { selectInterruptedRuns, useWorkflowResumePopover } from "./use-workflow-resume-popover";

const deps = vi.hoisted(() => ({
  useWorkflowRunsQuery: vi.fn(),
  isWorkflowsV2Enabled: vi.fn(),
  resumeRun: vi.fn(),
  selectWorkspaceFromSurface: vi.fn(),
  toastError: vi.fn(),
}));

// Only the runs list is stubbed. `useWorkflowRunProjectionWriter` stays REAL:
// the write-through this hook is responsible for is a real react-query cache
// write, and a spy on the writer would pass whether or not the projection ever
// reached the cache the run view reads.
vi.mock("@anyharness/sdk-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anyharness/sdk-react")>();
  return {
    ...actual,
    useWorkflowRunsQuery: (workspaceId: string | undefined, options: { enabled: boolean }) =>
      deps.useWorkflowRunsQuery(workspaceId, options),
  };
});

vi.mock("#product/lib/domain/capabilities/workflows-v2", () => ({
  isWorkflowsV2Enabled: () => deps.isWorkflowsV2Enabled(),
}));

vi.mock("#product/hooks/access/anyharness/workflows/use-workflow-run-resume", () => ({
  useWorkflowRunResume: () => deps.resumeRun,
}));

vi.mock("#product/hooks/workspaces/workflows/use-workspace-navigation-workflow", () => ({
  useWorkspaceNavigationWorkflow: () => ({
    selectWorkspaceFromSurface: deps.selectWorkspaceFromSurface,
  }),
}));

vi.mock("#product/primitives/utils/show-toast", () => ({
  showToast: vi.fn(),
  toastError: deps.toastError,
}));

const RESUME_DISMISSED_STORAGE_KEY = "proliferate.workflows-v2.resume-dismissed";
const RUNTIME_URL = "http://runtime.test";

function buildRun(overrides: Partial<WorkflowRunV2> = {}): WorkflowRunV2 {
  return {
    id: "run-1",
    invocationId: "invocation-1",
    definitionJson: "{}",
    argumentsJson: "{}",
    workspaceId: "workspace-1",
    status: "interrupted",
    currentNodeRowId: null,
    failureCode: null,
    interruptionCode: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

function readPersisted(): unknown {
  const raw = window.sessionStorage.getItem(RESUME_DISMISSED_STORAGE_KEY);
  return raw === null ? null : JSON.parse(raw);
}

function createQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <AnyHarnessRuntime runtimeUrl={RUNTIME_URL}>{children}</AnyHarnessRuntime>
      </QueryClientProvider>
    );
  };
}

function renderPopover(queryClient: QueryClient = createQueryClient()) {
  return renderHook(() => useWorkflowResumePopover(), { wrapper: createWrapper(queryClient) });
}

/** A resume response: the fresh, no-longer-interrupted projection of the run. */
function resumedProjection(run: WorkflowRunV2): WorkflowRunProjectionV2 {
  return {
    run: { ...run, status: "running", updatedAt: "2026-08-02T00:00:00.000Z" },
    nodes: [],
    docs: [],
  };
}

describe("selectInterruptedRuns (pure)", () => {
  it("keeps only interrupted runs whose current state is not the dismissed one", () => {
    const runA = buildRun({ id: "run-a", status: "interrupted" });
    const runB = buildRun({ id: "run-b", status: "running" });
    const runC = buildRun({ id: "run-c", status: "interrupted" });

    expect(
      selectInterruptedRuns(
        [runA, runB, runC],
        new Map([["run-c", "2026-08-01T00:00:00.000Z"]]),
      ),
    ).toEqual([runA]);
  });

  it("keeps a dismissed run whose updatedAt has moved on — that is a fresh interruption", () => {
    const reinterrupted = buildRun({ id: "run-c", updatedAt: "2026-08-03T00:00:00.000Z" });

    expect(
      selectInterruptedRuns(
        [reinterrupted],
        new Map([["run-c", "2026-08-01T00:00:00.000Z"]]),
      ),
    ).toEqual([reinterrupted]);
  });
});

describe("useWorkflowResumePopover", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    deps.isWorkflowsV2Enabled.mockReturnValue(true);
    deps.useWorkflowRunsQuery.mockReturnValue({ data: { runs: [] } });
    deps.resumeRun.mockResolvedValue(resumedProjection(buildRun()));
    deps.selectWorkspaceFromSurface.mockReset();
    deps.toastError.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
  });

  it("returns no runs and disables the query when the flag is off", () => {
    deps.isWorkflowsV2Enabled.mockReturnValue(false);
    const runA = buildRun({ id: "run-a" });
    // Even if a stray cached response were present, flag-off must still empty the result.
    deps.useWorkflowRunsQuery.mockReturnValue({ data: { runs: [runA] } });

    const { result } = renderPopover();

    expect(result.current.interruptedRuns).toEqual([]);
    expect(deps.useWorkflowRunsQuery).toHaveBeenCalledWith(undefined, { enabled: false });
  });

  it("filters out non-interrupted runs and runs dismissed in a prior session", () => {
    const runA = buildRun({ id: "run-a", status: "interrupted" });
    const runB = buildRun({ id: "run-b", status: "running" });
    const runC = buildRun({ id: "run-c", status: "interrupted" });
    window.sessionStorage.setItem(
      RESUME_DISMISSED_STORAGE_KEY,
      JSON.stringify({ "run-c": runC.updatedAt }),
    );
    deps.useWorkflowRunsQuery.mockReturnValue({ data: { runs: [runA, runB, runC] } });

    const { result } = renderPopover();

    expect(result.current.interruptedRuns.map((run) => run.id)).toEqual(["run-a"]);
    expect(deps.useWorkflowRunsQuery).toHaveBeenCalledWith(undefined, { enabled: true });
  });

  it("dismiss() removes a run immediately and persists it stamped with its updatedAt", () => {
    const runA = buildRun({ id: "run-a", updatedAt: "2026-08-01T09:00:00.000Z" });
    const runB = buildRun({ id: "run-b" });
    deps.useWorkflowRunsQuery.mockReturnValue({ data: { runs: [runA, runB] } });

    const { result } = renderPopover();
    expect(result.current.interruptedRuns.map((run) => run.id)).toEqual(["run-a", "run-b"]);

    act(() => {
      result.current.dismiss("run-a");
    });

    expect(result.current.interruptedRuns.map((run) => run.id)).toEqual(["run-b"]);
    expect(readPersisted()).toEqual({ "run-a": "2026-08-01T09:00:00.000Z" });
  });

  it("nudges again when a dismissed run is interrupted a second time", () => {
    const first = buildRun({ id: "run-a", updatedAt: "2026-08-01T09:00:00.000Z" });
    deps.useWorkflowRunsQuery.mockReturnValue({ data: { runs: [first] } });

    const { result, rerender } = renderPopover();

    act(() => {
      result.current.dismiss("run-a");
    });
    expect(result.current.interruptedRuns).toEqual([]);

    // Same run id, interrupted again: the runtime hands back a newer updatedAt,
    // so the stamp no longer names the run's current state.
    deps.useWorkflowRunsQuery.mockReturnValue({
      data: { runs: [buildRun({ id: "run-a", updatedAt: "2026-08-01T18:30:00.000Z" })] },
    });
    rerender();

    expect(result.current.interruptedRuns.map((run) => run.id)).toEqual(["run-a"]);
  });

  it("ignores a legacy id-array dismissal payload rather than hiding a parked run on it", () => {
    const runA = buildRun({ id: "run-a" });
    window.sessionStorage.setItem(RESUME_DISMISSED_STORAGE_KEY, JSON.stringify(["run-a"]));
    deps.useWorkflowRunsQuery.mockReturnValue({ data: { runs: [runA] } });

    const { result } = renderPopover();

    expect(result.current.interruptedRuns.map((run) => run.id)).toEqual(["run-a"]);
  });

  it("resumeAndOpen() dismisses the run on success, and navigates to its workspace", async () => {
    const runA = buildRun({ id: "run-a", workspaceId: "workspace-a" });
    deps.useWorkflowRunsQuery.mockReturnValue({ data: { runs: [runA] } });
    deps.resumeRun.mockResolvedValue(resumedProjection(runA));

    const { result } = renderPopover();

    await act(async () => {
      result.current.resumeAndOpen("run-a");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.interruptedRuns).toEqual([]);
    expect(deps.resumeRun).toHaveBeenCalledWith("run-a");
    expect(readPersisted()).toEqual({ "run-a": runA.updatedAt });
    expect(deps.toastError).not.toHaveBeenCalled();
    expect(deps.selectWorkspaceFromSurface).toHaveBeenCalledWith(
      "workspace-a",
      "workflow-resume-popover",
    );
  });

  it("resumeAndOpen() writes the resume response into the run's projection cache", async () => {
    const runA = buildRun({ id: "run-a", workspaceId: "workspace-a" });
    const projection = resumedProjection(runA);
    deps.useWorkflowRunsQuery.mockReturnValue({ data: { runs: [runA] } });
    deps.resumeRun.mockResolvedValue(projection);
    const queryClient = createQueryClient();

    const { result } = renderPopover(queryClient);

    await act(async () => {
      result.current.resumeAndOpen("run-a");
      await Promise.resolve();
      await Promise.resolve();
    });

    // The very entry a mounted run view reads: without this write it holds its
    // stale interrupted projection for a full staleTime with nothing to refresh it.
    const cached = queryClient.getQueryData<WorkflowRunProjectionV2>(
      anyHarnessWorkflowRunKey(RUNTIME_URL, RUNTIME_URL, "run-a"),
    );
    expect(cached).toBe(projection);
    expect(cached?.run.status).toBe("running");
  });

  it("resumeAndOpen() keeps the row, toasts, and persists nothing when the resume fails", async () => {
    const runA = buildRun({ id: "run-a", workspaceId: "workspace-a" });
    deps.useWorkflowRunsQuery.mockReturnValue({ data: { runs: [runA] } });
    deps.resumeRun.mockRejectedValue(new Error("the local runtime is restarting"));

    const { result } = renderPopover();

    await act(async () => {
      result.current.resumeAndOpen("run-a");
      await Promise.resolve();
      await Promise.resolve();
    });

    // The row is the only handle the user has on a parked run; a failed resume
    // must not consume it, and must not be silent about not consuming it.
    expect(result.current.interruptedRuns.map((run) => run.id)).toEqual(["run-a"]);
    expect(readPersisted()).toBeNull();
    expect(deps.toastError).toHaveBeenCalledTimes(1);
    expect(deps.toastError.mock.calls[0]?.[0]).toMatchObject({
      id: "workflow-resume-failed:run-a",
      headline: "Workflow resume failed",
      cause: "the local runtime is restarting",
    });
    expect(deps.selectWorkspaceFromSurface).toHaveBeenCalledWith(
      "workspace-a",
      "workflow-resume-popover",
    );
  });
});
