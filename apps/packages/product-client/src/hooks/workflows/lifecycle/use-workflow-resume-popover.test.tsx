// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowRunV2 } from "@anyharness/sdk";
import { selectInterruptedRuns, useWorkflowResumePopover } from "./use-workflow-resume-popover";

const deps = vi.hoisted(() => ({
  useWorkflowRunsQuery: vi.fn(),
  isWorkflowsV2Enabled: vi.fn(),
  resumeRun: vi.fn(),
  selectWorkspaceFromSurface: vi.fn(),
}));

vi.mock("@anyharness/sdk-react", () => ({
  useWorkflowRunsQuery: (workspaceId: string | undefined, options: { enabled: boolean }) =>
    deps.useWorkflowRunsQuery(workspaceId, options),
}));

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

const RESUME_DISMISSED_STORAGE_KEY = "proliferate.workflows-v2.resume-dismissed";

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

describe("selectInterruptedRuns (pure)", () => {
  it("keeps only interrupted runs not in the dismissed set", () => {
    const runA = buildRun({ id: "run-a", status: "interrupted" });
    const runB = buildRun({ id: "run-b", status: "running" });
    const runC = buildRun({ id: "run-c", status: "interrupted" });

    expect(selectInterruptedRuns([runA, runB, runC], new Set(["run-c"]))).toEqual([runA]);
  });
});

describe("useWorkflowResumePopover", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    deps.isWorkflowsV2Enabled.mockReturnValue(true);
    deps.useWorkflowRunsQuery.mockReturnValue({ data: { runs: [] } });
    deps.resumeRun.mockResolvedValue(undefined);
    deps.selectWorkspaceFromSurface.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
  });

  it("returns no runs and disables the query when the flag is off", () => {
    deps.isWorkflowsV2Enabled.mockReturnValue(false);
    deps.useWorkflowRunsQuery.mockReturnValue({ data: undefined });
    const runA = buildRun({ id: "run-a" });
    // Even if a stray cached response were present, flag-off must still empty the result.
    deps.useWorkflowRunsQuery.mockReturnValue({ data: { runs: [runA] } });

    const { result } = renderHook(() => useWorkflowResumePopover());

    expect(result.current.interruptedRuns).toEqual([]);
    expect(deps.useWorkflowRunsQuery).toHaveBeenCalledWith(undefined, { enabled: false });
  });

  it("filters out non-interrupted runs and runs dismissed in a prior session", () => {
    const runA = buildRun({ id: "run-a", status: "interrupted" });
    const runB = buildRun({ id: "run-b", status: "running" });
    const runC = buildRun({ id: "run-c", status: "interrupted" });
    window.sessionStorage.setItem(RESUME_DISMISSED_STORAGE_KEY, JSON.stringify(["run-c"]));
    deps.useWorkflowRunsQuery.mockReturnValue({ data: { runs: [runA, runB, runC] } });

    const { result } = renderHook(() => useWorkflowResumePopover());

    expect(result.current.interruptedRuns.map((run) => run.id)).toEqual(["run-a"]);
    expect(deps.useWorkflowRunsQuery).toHaveBeenCalledWith(undefined, { enabled: true });
  });

  it("dismiss() removes a run immediately and persists it to sessionStorage", () => {
    const runA = buildRun({ id: "run-a" });
    const runB = buildRun({ id: "run-b" });
    deps.useWorkflowRunsQuery.mockReturnValue({ data: { runs: [runA, runB] } });

    const { result } = renderHook(() => useWorkflowResumePopover());
    expect(result.current.interruptedRuns.map((run) => run.id)).toEqual(["run-a", "run-b"]);

    act(() => {
      result.current.dismiss("run-a");
    });

    expect(result.current.interruptedRuns.map((run) => run.id)).toEqual(["run-b"]);
    const persisted = JSON.parse(window.sessionStorage.getItem(RESUME_DISMISSED_STORAGE_KEY) ?? "[]");
    expect(persisted).toEqual(["run-a"]);
  });

  it("resumeAndOpen() dismisses the run, calls resume, and navigates to its workspace", async () => {
    const runA = buildRun({ id: "run-a", workspaceId: "workspace-a" });
    deps.useWorkflowRunsQuery.mockReturnValue({ data: { runs: [runA] } });
    deps.resumeRun.mockResolvedValue(undefined);

    const { result } = renderHook(() => useWorkflowResumePopover());

    await act(async () => {
      result.current.resumeAndOpen("run-a");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.interruptedRuns).toEqual([]);
    expect(deps.resumeRun).toHaveBeenCalledWith("run-a");
    expect(deps.selectWorkspaceFromSurface).toHaveBeenCalledWith("workspace-a", "workflow-resume-popover");
  });

  it("resumeAndOpen() still navigates when the resume call rejects", async () => {
    const runA = buildRun({ id: "run-a", workspaceId: "workspace-a" });
    deps.useWorkflowRunsQuery.mockReturnValue({ data: { runs: [runA] } });
    deps.resumeRun.mockRejectedValue(new Error("already resumed elsewhere"));

    const { result } = renderHook(() => useWorkflowResumePopover());

    await act(async () => {
      result.current.resumeAndOpen("run-a");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(deps.selectWorkspaceFromSurface).toHaveBeenCalledWith("workspace-a", "workflow-resume-popover");
  });
});
