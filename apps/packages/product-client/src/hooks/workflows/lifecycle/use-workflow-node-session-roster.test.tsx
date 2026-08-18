// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowRunNodeV2, WorkflowRunProjectionV2, WorkflowRunV2 } from "@anyharness/sdk";
import { useWorkflowNodeSessionRoster } from "#product/hooks/workflows/lifecycle/use-workflow-node-session-roster";

const mocks = vi.hoisted(() => ({
  snapshot: {
    sessions: [] as { id: string }[] | undefined,
    dataUpdatedAt: 1,
    isInvalidated: false,
  },
  invalidateWorkspaceSessions: vi.fn(),
}));

vi.mock("#product/hooks/access/anyharness/sessions/use-workspace-session-cache", () => ({
  useWorkspaceSessionCache: () => ({
    getWorkspaceSessionCacheSnapshot: () => mocks.snapshot,
    invalidateWorkspaceSessions: mocks.invalidateWorkspaceSessions,
  }),
}));

const WORKSPACE_ID = "workspace-node-roster";

function node(overrides: Partial<WorkflowRunNodeV2> = {}): WorkflowRunNodeV2 {
  return {
    id: "node-1",
    runId: "run-1",
    definitionNodeId: "step-1",
    kind: "defined",
    nodeType: "agent",
    replacesNodeRowId: null,
    anchorNodeRowId: null,
    chainIndex: 0,
    title: "Step",
    prompt: "Do the thing",
    status: "running",
    sessionId: "session-1",
    promptId: null,
    failureCode: null,
    createdAt: "2026-08-17T00:00:00Z",
    startedAt: "2026-08-17T00:00:00Z",
    completedAt: null,
    ...overrides,
  };
}

function projection(nodes: WorkflowRunNodeV2[]): WorkflowRunProjectionV2 {
  const run: WorkflowRunV2 = {
    id: "run-1",
    invocationId: "invocation-1",
    definitionJson: "{}",
    argumentsJson: "{}",
    workspaceId: WORKSPACE_ID,
    status: "running",
    currentNodeRowId: nodes[nodes.length - 1]?.id ?? null,
    failureCode: null,
    interruptionCode: null,
    createdAt: "2026-08-17T00:00:00Z",
    updatedAt: "2026-08-17T00:00:00Z",
    completedAt: null,
  };
  return { run, nodes, docs: [] };
}

describe("useWorkflowNodeSessionRoster", () => {
  beforeEach(() => {
    mocks.snapshot = { sessions: [], dataUpdatedAt: 1, isInvalidated: false };
    mocks.invalidateWorkspaceSessions.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("invalidates the roster when a node carries a session it has not seen", () => {
    mocks.snapshot.sessions = [{ id: "session-1" }];
    renderHook(() => useWorkflowNodeSessionRoster({
      workspaceId: WORKSPACE_ID,
      projection: projection([
        node(),
        node({ id: "node-2", chainIndex: 1, sessionId: "session-2" }),
      ]),
    }));

    expect(mocks.invalidateWorkspaceSessions).toHaveBeenCalledWith(WORKSPACE_ID);
  });

  it("leaves the roster alone when every node session is already in it", () => {
    mocks.snapshot.sessions = [{ id: "session-1" }, { id: "session-2" }];
    renderHook(() => useWorkflowNodeSessionRoster({
      workspaceId: WORKSPACE_ID,
      projection: projection([
        node(),
        node({ id: "node-2", chainIndex: 1, sessionId: "session-2" }),
      ]),
    }));

    expect(mocks.invalidateWorkspaceSessions).not.toHaveBeenCalled();
  });

  it("invalidates once per session across repeated polls of the same projection", () => {
    mocks.snapshot.sessions = [{ id: "session-1" }];
    const nodes = [node(), node({ id: "node-2", chainIndex: 1, sessionId: "session-2" })];
    const { rerender } = renderHook(
      (props: { projection: WorkflowRunProjectionV2 }) => useWorkflowNodeSessionRoster({
        workspaceId: WORKSPACE_ID,
        projection: props.projection,
      }),
      { initialProps: { projection: projection(nodes) } },
    );

    // A fresh projection object every poll, same nodes: the roster refetch the
    // first one started is still the only one worth asking for.
    rerender({ projection: projection(nodes) });
    rerender({ projection: projection(nodes) });

    expect(mocks.invalidateWorkspaceSessions).toHaveBeenCalledTimes(1);
  });

  it("stays quiet while the roster has never loaded", () => {
    mocks.snapshot = { sessions: undefined, dataUpdatedAt: 0, isInvalidated: false };
    renderHook(() => useWorkflowNodeSessionRoster({
      workspaceId: WORKSPACE_ID,
      projection: projection([node({ sessionId: "session-2" })]),
    }));

    expect(mocks.invalidateWorkspaceSessions).not.toHaveBeenCalled();
  });

  it("stays quiet without a workspace or a projection", () => {
    renderHook(() => useWorkflowNodeSessionRoster({
      workspaceId: null,
      projection: projection([node({ sessionId: "session-2" })]),
    }));
    renderHook(() => useWorkflowNodeSessionRoster({
      workspaceId: WORKSPACE_ID,
      projection: undefined,
    }));

    expect(mocks.invalidateWorkspaceSessions).not.toHaveBeenCalled();
  });
});
