// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnyHarnessError } from "@anyharness/sdk";
import type {
  WorkflowRunNodeV2,
  WorkflowRunProjectionV2,
  WorkflowRunV2,
} from "@anyharness/sdk";
import type { SidebarSessionActivityState } from "#product/domain/sessions/activity";
import {
  isWorkflowTransitionRace,
  resolveWorkflowPaneStatus,
  selectNewestWorkflowRun,
  useWorkflowPane,
} from "#product/hooks/workflows/facade/use-workflow-pane";

const mocks = vi.hoisted(() => {
  const mutation = () => ({ mutateAsync: vi.fn(async () => ({})), isPending: false });
  const mutations = {
    putRun: mutation(),
    approve: mutation(),
    failRedo: mutation(),
    flipType: mutation(),
    undoAdvance: mutation(),
    resume: mutation(),
    addAdhocNode: mutation(),
  };
  return {
    mutations,
    runsQuery: { data: undefined as unknown, isError: false },
    runQuery: { data: undefined as unknown, isError: false, refetch: vi.fn(async () => ({})) },
    runQueryCalls: [] as (string | null | undefined)[],
    activityStates: {} as Record<string, SidebarSessionActivityState>,
    useWorkflowRunsQuery: vi.fn(() => mocks.runsQuery),
    useWorkflowRunQuery: vi.fn((runId: string | null | undefined) => {
      mocks.runQueryCalls.push(runId);
      return mocks.runQuery;
    }),
    useWorkflowRunMutations: vi.fn(() => mocks.mutations),
    openWorkspaceSession: vi.fn(),
    showToast: vi.fn(),
    toastError: vi.fn(),
  };
});

vi.mock("@anyharness/sdk-react", () => ({
  useWorkflowRunsQuery: mocks.useWorkflowRunsQuery,
  useWorkflowRunQuery: mocks.useWorkflowRunQuery,
  useWorkflowRunMutations: mocks.useWorkflowRunMutations,
}));

vi.mock("#product/hooks/workspaces/workflows/use-workspace-activation-workflow", () => ({
  useWorkspaceActivationWorkflow: () => ({
    openWorkspaceSession: mocks.openWorkspaceSession,
  }),
}));

vi.mock("#product/hooks/workspaces/derived/use-workspace-sidebar-activities", () => ({
  useWorkspaceSidebarActivityStates: () => mocks.activityStates,
}));

vi.mock("#product/primitives/utils/show-toast", () => ({
  showToast: mocks.showToast,
  toastError: mocks.toastError,
}));

const WORKSPACE_ID = "workspace-workflow-pane";

function run(overrides: Partial<WorkflowRunV2> = {}): WorkflowRunV2 {
  return {
    id: "run-1",
    invocationId: "invocation-1",
    definitionJson: "{}",
    argumentsJson: "{}",
    workspaceId: WORKSPACE_ID,
    status: "running",
    currentNodeRowId: null,
    failureCode: null,
    interruptionCode: null,
    createdAt: "2026-08-14T00:00:00Z",
    updatedAt: "2026-08-14T00:00:00Z",
    completedAt: null,
    ...overrides,
  };
}

function node(
  overrides: Partial<WorkflowRunNodeV2> & { id: string },
): WorkflowRunNodeV2 {
  return {
    runId: "run-1",
    definitionNodeId: overrides.id,
    kind: "defined",
    nodeType: "agent",
    replacesNodeRowId: null,
    anchorNodeRowId: null,
    chainIndex: 0,
    title: overrides.id,
    prompt: "",
    status: "pending",
    sessionId: null,
    promptId: null,
    failureCode: null,
    createdAt: "2026-08-14T00:00:00Z",
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

function projection(
  nodes: WorkflowRunNodeV2[],
  overrides: Partial<WorkflowRunV2> = {},
): WorkflowRunProjectionV2 {
  return { run: run(overrides), nodes, docs: [] };
}

function transitionIllegal(): AnyHarnessError {
  return new AnyHarnessError({
    type: "about:blank",
    title: "Illegal transition",
    status: 409,
    detail: "node is not awaiting human review",
    code: "WORKFLOW_TRANSITION_ILLEGAL",
  });
}

function render() {
  return renderHook(() => useWorkflowPane({ workspaceId: WORKSPACE_ID }));
}

beforeEach(() => {
  mocks.runsQuery.data = { runs: [run()] };
  mocks.runsQuery.isError = false;
  mocks.runQuery.data = projection([node({ id: "a" })]);
  mocks.runQuery.isError = false;
  mocks.runQueryCalls.length = 0;
  mocks.activityStates = {};
  for (const mutation of Object.values(mocks.mutations)) {
    mutation.mutateAsync = vi.fn(async () => ({}));
    mutation.isPending = false;
  }
  mocks.runQuery.refetch = vi.fn(async () => ({}));
  mocks.openWorkspaceSession.mockClear();
  mocks.showToast.mockClear();
  mocks.toastError.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("selectNewestWorkflowRun", () => {
  it("returns null when the workspace has no runs", () => {
    expect(selectNewestWorkflowRun([])).toBeNull();
    expect(selectNewestWorkflowRun(undefined)).toBeNull();
  });

  it("returns the newest run by createdAt regardless of list order", () => {
    const newest = selectNewestWorkflowRun([
      run({ id: "old", createdAt: "2026-08-14T00:00:00Z" }),
      run({ id: "new", createdAt: "2026-08-14T09:00:00Z" }),
      run({ id: "middle", createdAt: "2026-08-14T04:00:00Z" }),
    ]);

    expect(newest?.id).toBe("new");
  });

  it("breaks a createdAt tie by row id so the winner never flickers", () => {
    const sameInstant = "2026-08-14T00:00:00Z";
    expect(selectNewestWorkflowRun([
      run({ id: "a", createdAt: sameInstant }),
      run({ id: "b", createdAt: sameInstant }),
    ])?.id).toBe("b");
  });
});

describe("isWorkflowTransitionRace", () => {
  it("recognises the runtime's illegal-transition problem code", () => {
    expect(isWorkflowTransitionRace(transitionIllegal())).toBe(true);
  });

  it("rejects every other failure, including other 409s and plain errors", () => {
    expect(isWorkflowTransitionRace(new AnyHarnessError({
      type: "about:blank",
      title: "Conflict",
      status: 409,
      code: "WORKFLOW_RUN_NOT_FOUND",
    }))).toBe(false);
    expect(isWorkflowTransitionRace(new Error("network down"))).toBe(false);
    expect(isWorkflowTransitionRace(undefined)).toBe(false);
  });
});

describe("resolveWorkflowPaneStatus", () => {
  const base = {
    runsLoaded: true,
    runsFailed: false,
    hasRun: true,
    projectionLoaded: true,
    projectionFailed: false,
  };

  it("is loading until the runs list arrives", () => {
    expect(resolveWorkflowPaneStatus({ ...base, runsLoaded: false })).toBe("loading");
  });

  it("is error when the runs list failed with nothing cached", () => {
    expect(resolveWorkflowPaneStatus({ ...base, runsLoaded: false, runsFailed: true }))
      .toBe("error");
  });

  it("is empty when the workspace has no run", () => {
    expect(resolveWorkflowPaneStatus({ ...base, hasRun: false })).toBe("empty");
  });

  it("keeps a rendered projection through a failed poll", () => {
    expect(resolveWorkflowPaneStatus({ ...base, projectionFailed: true })).toBe("ready");
  });
});

describe("useWorkflowPane", () => {
  it("binds the run detail query to the workspace's newest run", () => {
    mocks.runsQuery.data = {
      runs: [
        run({ id: "older", createdAt: "2026-08-13T00:00:00Z" }),
        run({ id: "newest", createdAt: "2026-08-14T00:00:00Z" }),
      ],
    };
    mocks.runQuery.data = projection([node({ id: "a" })], { id: "newest" });

    const { result } = render();

    expect(mocks.runQueryCalls.at(-1)).toBe("newest");
    expect(result.current.run?.id).toBe("newest");
    expect(result.current.status).toBe("ready");
  });

  it("reads the run header off the polled projection, not the unpolled list", () => {
    // Only the detail query polls, so a run that parks while the pane is open
    // shows up here and nowhere else.
    mocks.runsQuery.data = { runs: [run({ status: "running" })] };
    mocks.runQuery.data = projection([node({ id: "a" })], { status: "interrupted" });

    const { result } = render();

    expect(result.current.run?.status).toBe("interrupted");
    expect(result.current.interrupted).toBe(true);
  });

  it("reports the empty state when the workspace has no runs at all", () => {
    mocks.runsQuery.data = { runs: [] };

    const { result } = render();

    expect(result.current.status).toBe("empty");
    expect(result.current.run).toBeNull();
    expect(result.current.slots).toEqual([]);
  });

  it("projects the run into slots, docs, node index and the interrupted flag", () => {
    mocks.runQuery.data = {
      ...projection(
        [node({ id: "a", chainIndex: 0 }), node({ id: "b", chainIndex: 1 })],
        { status: "interrupted", currentNodeRowId: "b" },
      ),
      docs: [{
        id: "doc-1",
        runId: "run-1",
        slug: "plan",
        filename: "plan.md",
        producingNodeRowId: "a",
        seededFromTemplate: true,
        createdAt: "2026-08-14T00:00:00Z",
        updatedAt: "2026-08-14T00:00:00Z",
      }],
    };
    mocks.runsQuery.data = { runs: [run({ status: "interrupted" })] };

    const { result } = render();

    expect(result.current.slots.map((slot) => slot.chainIndex)).toEqual([0, 1]);
    expect(result.current.docs.map((doc) => doc.slug)).toEqual(["plan"]);
    expect([...result.current.nodesById.keys()]).toEqual(["a", "b"]);
    expect(result.current.interrupted).toBe(true);
  });

  it("marks a node as needing input from the session roster's own signal", () => {
    mocks.runQuery.data = projection([
      node({ id: "a", sessionId: "session-a" }),
      node({ id: "b", sessionId: "session-b" }),
      node({ id: "c", sessionId: null }),
    ]);
    mocks.activityStates = {
      "session-a": "waiting_input",
      "session-b": "iterating",
    };

    const { result } = render();

    expect([...result.current.needsInputNodeRowIds]).toEqual(["a"]);
  });

  it("focuses a node's session through the shell's session activation", async () => {
    mocks.runQuery.data = projection([node({ id: "a", sessionId: "session-a" })]);

    const { result } = render();
    await act(async () => {
      result.current.actions.focusNodeSession("a");
    });

    expect(mocks.openWorkspaceSession).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      sessionId: "session-a",
      forceWorkspaceSelection: false,
    });
  });

  it("does nothing when the node has no session yet", async () => {
    mocks.runQuery.data = projection([node({ id: "a", sessionId: null })]);

    const { result } = render();
    await act(async () => {
      result.current.actions.focusNodeSession("a");
    });

    expect(mocks.openWorkspaceSession).not.toHaveBeenCalled();
  });

  it("sends each control to its command", async () => {
    const { result } = render();
    await act(async () => {
      result.current.actions.approve("a");
      result.current.actions.failRedo("a", "try again");
      result.current.actions.flipType("a", "human_in_loop");
      result.current.actions.addAdhocNode("a", "look at the flake");
      result.current.actions.resume();
    });

    expect(mocks.mutations.approve.mutateAsync).toHaveBeenCalledWith({ nodeRowId: "a" });
    expect(mocks.mutations.failRedo.mutateAsync).toHaveBeenCalledWith({
      nodeRowId: "a",
      request: { prompt: "try again" },
    });
    expect(mocks.mutations.flipType.mutateAsync).toHaveBeenCalledWith({
      nodeRowId: "a",
      request: { nodeType: "human_in_loop" },
    });
    expect(mocks.mutations.addAdhocNode.mutateAsync).toHaveBeenCalledWith({
      request: { anchorNodeRowId: "a", prompt: "look at the flake" },
    });
    expect(mocks.mutations.resume.mutateAsync).toHaveBeenCalled();
  });

  it("omits the prompt entirely when fail-redo is given none", async () => {
    const { result } = render();
    await act(async () => {
      result.current.actions.failRedo("a");
    });

    expect(mocks.mutations.failRedo.mutateAsync).toHaveBeenCalledWith({
      nodeRowId: "a",
      request: {},
    });
  });

  it("turns a 409 illegal transition into a toast and refetch, never a rejection", async () => {
    mocks.mutations.approve.mutateAsync = vi.fn(async () => {
      throw transitionIllegal();
    });

    const { result } = render();
    await act(async () => {
      result.current.actions.approve("a");
    });

    expect(mocks.showToast).toHaveBeenCalledTimes(1);
    expect(mocks.showToast.mock.calls[0]![0]).toMatchObject({
      title: "The run already moved on",
      tone: "warning",
    });
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(mocks.runQuery.refetch).toHaveBeenCalled();
  });

  it("reports any other command failure as an error toast carrying the cause", async () => {
    mocks.mutations.resume.mutateAsync = vi.fn(async () => {
      throw new Error("runtime unreachable");
    });

    const { result } = render();
    await act(async () => {
      result.current.actions.resume();
    });

    expect(mocks.toastError).toHaveBeenCalledWith({
      headline: "Workflow action failed",
      consequence: "The run is unchanged.",
      cause: "runtime unreachable",
    });
    expect(mocks.showToast).not.toHaveBeenCalled();
  });

  it("stays quiet on first load, then offers Undo once the run advances by itself", async () => {
    mocks.runQuery.data = projection(
      [
        node({ id: "a", chainIndex: 0, status: "running" }),
        node({ id: "b", chainIndex: 1 }),
      ],
      { currentNodeRowId: "a" },
    );

    const { rerender } = render();
    expect(mocks.showToast).not.toHaveBeenCalled();

    mocks.runQuery.data = projection(
      [
        node({ id: "a", chainIndex: 0, status: "completed", title: "Draft" }),
        node({ id: "b", chainIndex: 1, status: "running", title: "Review" }),
      ],
      { currentNodeRowId: "b" },
    );
    await act(async () => {
      rerender();
    });

    expect(mocks.showToast).toHaveBeenCalledTimes(1);
    const raised = mocks.showToast.mock.calls[0]![0];
    expect(raised).toMatchObject({
      title: "1. Draft done, 2. Review started",
      commit: { label: "Undo" },
    });

    await act(async () => {
      raised.commit.onClick();
    });
    expect(mocks.mutations.undoAdvance.mutateAsync).toHaveBeenCalled();
  });

  it("offers the undo at most once per started node across repeated polls", async () => {
    mocks.runQuery.data = projection(
      [node({ id: "a", chainIndex: 0, status: "running" }), node({ id: "b", chainIndex: 1 })],
      { currentNodeRowId: "a" },
    );
    const { rerender } = render();

    const advanced = () => projection(
      [
        node({ id: "a", chainIndex: 0, status: "completed" }),
        node({ id: "b", chainIndex: 1, status: "running" }),
      ],
      { currentNodeRowId: "b" },
    );

    mocks.runQuery.data = advanced();
    await act(async () => {
      rerender();
    });
    // A later poll re-delivers a fresh object for the same advance; the run
    // did not move again, but even a detector hit must not re-offer it.
    mocks.runQuery.data = advanced();
    await act(async () => {
      rerender();
    });

    expect(mocks.showToast).toHaveBeenCalledTimes(1);
  });

  it("raises no undo offer when a human approval moved the run on", async () => {
    mocks.runQuery.data = projection(
      [
        node({ id: "a", chainIndex: 0, status: "awaiting_human", nodeType: "human_in_loop" }),
        node({ id: "b", chainIndex: 1 }),
      ],
      { currentNodeRowId: "a" },
    );
    const { rerender } = render();

    mocks.runQuery.data = projection(
      [
        node({ id: "a", chainIndex: 0, status: "completed", nodeType: "human_in_loop" }),
        node({ id: "b", chainIndex: 1, status: "running" }),
      ],
      { currentNodeRowId: "b" },
    );
    await act(async () => {
      rerender();
    });

    expect(mocks.showToast).not.toHaveBeenCalled();
  });

  it("reports busy while any command is in flight", () => {
    mocks.mutations.flipType.isPending = true;

    const { result } = render();

    expect(result.current.busy).toBe(true);
  });
});
