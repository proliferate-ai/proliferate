// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnyHarnessError } from "@anyharness/sdk";
import type {
  WorkflowRunNodeV2,
  WorkflowRunProjectionV2,
  WorkflowRunV2,
} from "@anyharness/sdk";
import {
  useWorkflowAutoAdvanceWatch,
  workflowAutoAdvanceAnnouncementKey,
} from "#product/hooks/workflows/lifecycle/use-workflow-auto-advance-toast";

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
    runsQueryCalls: [] as unknown[][],
    runQueryCalls: [] as unknown[][],
    useWorkflowRunsQuery: vi.fn((...args: unknown[]) => {
      mocks.runsQueryCalls.push(args);
      return mocks.runsQuery;
    }),
    useWorkflowRunQuery: vi.fn((...args: unknown[]) => {
      mocks.runQueryCalls.push(args);
      return mocks.runQuery;
    }),
    useWorkflowRunMutations: vi.fn(() => mocks.mutations),
    showToast: vi.fn(),
    toastError: vi.fn(),
    workflowsV2Enabled: true,
    sessionCacheSnapshot: { sessions: [], dataUpdatedAt: 0, isInvalidated: false },
    invalidateWorkspaceSessions: vi.fn(),
  };
});

vi.mock("@anyharness/sdk-react", () => ({
  useWorkflowRunsQuery: mocks.useWorkflowRunsQuery,
  useWorkflowRunQuery: mocks.useWorkflowRunQuery,
  useWorkflowRunMutations: mocks.useWorkflowRunMutations,
}));

vi.mock("#product/lib/domain/capabilities/workflows-v2", () => ({
  isWorkflowsV2Enabled: () => mocks.workflowsV2Enabled,
}));

// The roster reconciler the watch also mounts owns its own suite; here it only
// has to resolve without a react-query provider.
vi.mock("#product/hooks/access/anyharness/sessions/use-workspace-session-cache", () => ({
  useWorkspaceSessionCache: () => ({
    getWorkspaceSessionCacheSnapshot: () => mocks.sessionCacheSnapshot,
    invalidateWorkspaceSessions: mocks.invalidateWorkspaceSessions,
  }),
}));

vi.mock("#product/primitives/utils/show-toast", () => ({
  showToast: mocks.showToast,
  toastError: mocks.toastError,
}));

const WORKSPACE_ID = "workspace-workflow-watch";

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

/** The run parked on node `a`, before it advances. */
function beforeAdvance(): WorkflowRunProjectionV2 {
  return projection(
    [
      node({ id: "a", chainIndex: 0, status: "running", title: "Draft" }),
      node({ id: "b", chainIndex: 1, title: "Review" }),
    ],
    { currentNodeRowId: "a" },
  );
}

/** The same run one poll later: `a` completed by itself and `b` started at `startedAt`. */
function afterAdvance(startedAt: string): WorkflowRunProjectionV2 {
  return projection(
    [
      node({ id: "a", chainIndex: 0, status: "completed", title: "Draft" }),
      node({ id: "b", chainIndex: 1, status: "running", title: "Review", startedAt }),
    ],
    { currentNodeRowId: "b" },
  );
}

/** The run after the user undid the advance: `b` back to pending with no start instant. */
function afterUndo(): WorkflowRunProjectionV2 {
  return projection(
    [
      node({ id: "a", chainIndex: 0, status: "awaiting_human", title: "Draft" }),
      node({ id: "b", chainIndex: 1, status: "pending", title: "Review", startedAt: null }),
    ],
    { currentNodeRowId: "a", status: "awaiting_human" },
  );
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

function render(enabled = true) {
  return renderHook(
    (props: { enabled: boolean }) => useWorkflowAutoAdvanceWatch({
      workspaceId: WORKSPACE_ID,
      enabled: props.enabled,
    }),
    { initialProps: { enabled } },
  );
}

beforeEach(() => {
  mocks.runsQuery.data = { runs: [run()] };
  mocks.runsQuery.isError = false;
  mocks.runQuery.data = undefined;
  mocks.runQuery.isError = false;
  mocks.runQuery.refetch = vi.fn(async () => ({}));
  mocks.runsQueryCalls.length = 0;
  mocks.runQueryCalls.length = 0;
  mocks.workflowsV2Enabled = true;
  for (const mutation of Object.values(mocks.mutations)) {
    mutation.mutateAsync = vi.fn(async () => ({}));
    mutation.isPending = false;
  }
  mocks.showToast.mockClear();
  mocks.toastError.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("workflowAutoAdvanceAnnouncementKey", () => {
  it("keys an advance by the started row and the instant it started", () => {
    expect(workflowAutoAdvanceAnnouncementKey(
      node({ id: "b", startedAt: "2026-08-14T01:00:00Z" }),
    )).toBe("b@2026-08-14T01:00:00Z");
  });

  it("separates two starts of the same row, and never collides with an unstarted row", () => {
    const first = workflowAutoAdvanceAnnouncementKey(
      node({ id: "b", startedAt: "2026-08-14T01:00:00Z" }),
    );
    const second = workflowAutoAdvanceAnnouncementKey(
      node({ id: "b", startedAt: "2026-08-14T02:00:00Z" }),
    );
    expect(second).not.toBe(first);
    expect(workflowAutoAdvanceAnnouncementKey(node({ id: "b", startedAt: null })))
      .toBe("b@unstarted");
  });
});

describe("useWorkflowAutoAdvanceWatch", () => {
  it("watches the workspace's newest run without the pane being mounted", () => {
    mocks.runsQuery.data = {
      runs: [
        run({ id: "older", createdAt: "2026-08-13T00:00:00Z" }),
        run({ id: "newest", createdAt: "2026-08-14T00:00:00Z" }),
      ],
    };

    render();

    expect(mocks.runsQueryCalls.at(-1)).toEqual([
      WORKSPACE_ID,
      { enabled: true, watchActiveRuns: true },
    ]);
    expect(mocks.runQueryCalls.at(-1)).toEqual(["newest", { enabled: true }]);
  });

  it("offers Undo on an auto-advance while the panel shows another tool", async () => {
    // No pane in this tree at all: the watcher is the only mount, which is what
    // a collapsed panel or a workspace parked on the scratch tool looks like.
    mocks.runQuery.data = beforeAdvance();
    const { rerender } = render();
    expect(mocks.showToast).not.toHaveBeenCalled();

    mocks.runQuery.data = afterAdvance("2026-08-14T01:00:00Z");
    await act(async () => {
      rerender({ enabled: true });
    });

    expect(mocks.showToast).toHaveBeenCalledTimes(1);
    const raised = mocks.showToast.mock.calls[0]![0];
    expect(raised).toMatchObject({
      id: "workflow-auto-advance:run-1",
      title: "1. Draft done, 2. Review started",
      commit: { label: "Undo" },
    });

    await act(async () => {
      raised.commit.onClick();
    });
    expect(mocks.mutations.undoAdvance.mutateAsync).toHaveBeenCalled();
  });

  it("offers the undo at most once per advance across repeated polls", async () => {
    mocks.runQuery.data = beforeAdvance();
    const { rerender } = render();

    mocks.runQuery.data = afterAdvance("2026-08-14T01:00:00Z");
    await act(async () => {
      rerender({ enabled: true });
    });
    // A later poll re-delivers a fresh object for the same advance; the run did
    // not move again, but even a detector hit must not re-offer it.
    mocks.runQuery.data = afterAdvance("2026-08-14T01:00:00Z");
    await act(async () => {
      rerender({ enabled: true });
    });

    expect(mocks.showToast).toHaveBeenCalledTimes(1);
  });

  it("offers Undo again when a genuine second advance re-enters the same node", async () => {
    mocks.runQuery.data = beforeAdvance();
    const { rerender } = render();

    mocks.runQuery.data = afterAdvance("2026-08-14T01:00:00Z");
    await act(async () => {
      rerender({ enabled: true });
    });
    expect(mocks.showToast).toHaveBeenCalledTimes(1);

    // Undo, then a fail-and-redo of the step before it runs and finishes: the
    // run advances into the same row a second time, with a fresh start instant.
    mocks.runQuery.data = afterUndo();
    await act(async () => {
      rerender({ enabled: true });
    });
    mocks.runQuery.data = beforeAdvance();
    await act(async () => {
      rerender({ enabled: true });
    });
    mocks.runQuery.data = afterAdvance("2026-08-14T02:00:00Z");
    await act(async () => {
      rerender({ enabled: true });
    });

    expect(mocks.showToast).toHaveBeenCalledTimes(2);
  });

  it("keeps the projection it last saw across an advance that lands between renders", async () => {
    // The watcher outlives the pane, so the previous projection is never
    // dropped by a tool switch: the first poll after one still diffs.
    mocks.runQuery.data = beforeAdvance();
    const { rerender } = render();

    mocks.runQuery.data = beforeAdvance();
    await act(async () => {
      rerender({ enabled: true });
    });
    mocks.runQuery.data = afterAdvance("2026-08-14T01:00:00Z");
    await act(async () => {
      rerender({ enabled: true });
    });

    expect(mocks.showToast).toHaveBeenCalledTimes(1);
  });

  it("turns a late undo into the race toast, never a rejection", async () => {
    mocks.runQuery.data = beforeAdvance();
    const { rerender } = render();

    mocks.runQuery.data = afterAdvance("2026-08-14T01:00:00Z");
    await act(async () => {
      rerender({ enabled: true });
    });
    const raised = mocks.showToast.mock.calls[0]![0];
    mocks.mutations.undoAdvance.mutateAsync = vi.fn(async () => {
      throw transitionIllegal();
    });

    await act(async () => {
      raised.commit.onClick();
    });

    expect(mocks.showToast).toHaveBeenCalledTimes(2);
    expect(mocks.showToast.mock.calls[1]![0]).toMatchObject({
      id: "workflow-run-race:run-1",
      title: "The run already moved on",
      tone: "warning",
    });
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(mocks.runQuery.refetch).toHaveBeenCalled();
  });

  it("raises no offer when a human approval moved the run on (negative control)", async () => {
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
        node({ id: "b", chainIndex: 1, status: "running", startedAt: "2026-08-14T01:00:00Z" }),
      ],
      { currentNodeRowId: "b" },
    );
    await act(async () => {
      rerender({ enabled: true });
    });

    expect(mocks.showToast).not.toHaveBeenCalled();
  });

  it("asks the runtime nothing while the launch gate is off", () => {
    mocks.workflowsV2Enabled = false;

    render();

    expect(mocks.runsQueryCalls.at(-1)).toEqual([
      WORKSPACE_ID,
      { enabled: false, watchActiveRuns: true },
    ]);
    expect(mocks.runQueryCalls.at(-1)?.[1]).toEqual({ enabled: false });
  });

  it("stays quiet on a workspace whose shell is not rendering content yet", async () => {
    mocks.runQuery.data = beforeAdvance();
    const { rerender } = render(false);

    mocks.runQuery.data = afterAdvance("2026-08-14T01:00:00Z");
    await act(async () => {
      rerender({ enabled: false });
    });

    expect(mocks.showToast).not.toHaveBeenCalled();
  });
});
