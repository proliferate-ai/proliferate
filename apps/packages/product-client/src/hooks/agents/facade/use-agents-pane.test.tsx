// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentOperationsAgent,
  SessionSubagentsResponse,
  SubagentParentRoster,
  SubagentRosterEntry,
  WorkspaceSubagentsResponse,
} from "@anyharness/sdk";
import type {
  AgentsPaneLifecycleFailure,
  AgentsPanePromoteOutcome,
} from "#product/hooks/agents/workflows/use-agents-pane-lifecycle-actions";
import { useAgentsPane } from "#product/hooks/agents/facade/use-agents-pane";
import { useAgentsPaneNavigationStore } from "#product/stores/agents/agents-pane-navigation-store";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";

const mocks = vi.hoisted(() => {
  const query = () => ({
    data: undefined as unknown,
    dataUpdatedAt: 0,
    isLoading: false,
    isError: false,
    isFetching: false,
    isSuccess: false,
    refetch: vi.fn(),
  });
  const workspaceQuery = query();
  const parentQuery = query();
  const sessionsQuery = query();
  return {
    workspaceQuery,
    parentQuery,
    sessionsQuery,
    useWorkspaceSubagentsQuery: vi.fn(() => workspaceQuery),
    useSessionSubagentsQuery: vi.fn(() => parentQuery),
    useWorkspaceSessionsQuery: vi.fn(() => sessionsQuery),
    openWorkspaceSession: vi.fn(),
  };
});

vi.mock("@anyharness/sdk-react", () => ({
  useWorkspaceSubagentsQuery: mocks.useWorkspaceSubagentsQuery,
  useSessionSubagentsQuery: mocks.useSessionSubagentsQuery,
  useWorkspaceSessionsQuery: mocks.useWorkspaceSessionsQuery,
}));

vi.mock("#product/hooks/workspaces/workflows/use-workspace-activation-workflow", () => ({
  useWorkspaceActivationWorkflow: () => ({
    openWorkspaceSession: mocks.openWorkspaceSession,
  }),
}));

const WORKSPACE_ID = "workspace-agents-pane";
const PARENT_ID = "parent-durable";
const CHILD_ID = "child-durable";
const CLIENT_CHILD_ID = "child-client";
const SIBLING_ID = "sibling-durable";

function agent(
  sessionId: string,
  title: string,
  presentation: AgentOperationsAgent["status"]["presentation"] = "available",
): AgentOperationsAgent {
  return {
    capabilities: [],
    configuration: { agentKind: "claude" },
    createdAt: "2026-08-11T00:00:00Z",
    identity: { runtimeId: "runtime-1", sessionId },
    parent: null,
    role: "subagent",
    status: {
      execution: presentation === "closed" ? "closed" : "idle",
      hasLiveActor: presentation === "running",
      presentation,
    },
    title,
    updatedAt: "2026-08-11T00:00:00Z",
    workspace: { runtimeId: "runtime-1", workspaceId: WORKSPACE_ID },
  };
}

function childEntry(sessionId: string, title: string): SubagentRosterEntry {
  return {
    agent: agent(sessionId, title),
    latestCompletion: null,
    relationship: {
      childSessionId: sessionId,
      createdAt: "2026-08-11T00:00:00Z",
      label: title,
      parentSessionId: PARENT_ID,
      sessionLinkId: `link-${sessionId}`,
    },
  };
}

const CHILD_ENTRY = childEntry(CHILD_ID, "Primary worker");
const SIBLING_ENTRY = childEntry(SIBLING_ID, "Sibling worker");
const ROSTER: SubagentParentRoster = {
  parent: agent(PARENT_ID, "Parent conversation", "running"),
  children: [CHILD_ENTRY, SIBLING_ENTRY],
};
const WORKSPACE_RESPONSE: WorkspaceSubagentsResponse = { parents: [ROSTER] };
const PARENT_RESPONSE: SessionSubagentsResponse = {
  parent: ROSTER.parent,
  children: ROSTER.children,
};

function installMappedChild() {
  useSessionDirectoryStore.getState().upsertEntry({
    sessionId: CLIENT_CHILD_ID,
    materializedSessionId: CHILD_ID,
    workspaceId: WORKSPACE_ID,
    agentKind: "claude",
    sessionRelationship: {
      kind: "subagent_child",
      parentSessionId: PARENT_ID,
      sessionLinkId: `link-${CHILD_ID}`,
      relation: "subagent",
      workspaceId: WORKSPACE_ID,
    },
  });
}

function failure(
  overrides: Partial<AgentsPaneLifecycleFailure> = {},
): AgentsPaneLifecycleFailure {
  return {
    ok: false,
    action: "promote",
    kind: "not_found",
    status: 404,
    code: null,
    message: "The durable child was not found.",
    parentSessionId: PARENT_ID,
    childSessionId: CHILD_ID,
    clientSessionId: CLIENT_CHILD_ID,
    ...overrides,
  };
}

function promotion(): AgentsPanePromoteOutcome {
  return {
    ok: true,
    agent: CHILD_ENTRY.agent,
    workspaceId: WORKSPACE_ID,
    parentSessionId: PARENT_ID,
    childSessionId: CHILD_ID,
    clientSessionId: CLIENT_CHILD_ID,
  };
}

function allOverviewChildIds(model: ReturnType<typeof useAgentsPane>["overviewModel"]) {
  return model?.parents.flatMap((parent) =>
    parent.groups.flatMap((group) => group.children.map((child) => child.sessionId))
  ) ?? [];
}

function openChildDetail(result: { current: ReturnType<typeof useAgentsPane> }) {
  act(() => result.current.selectParent(result.current.overviewModel!.parents[0]!));
  const child = result.current.focusedParent!.groups
    .flatMap((group) => group.children)
    .find((entry) => entry.sessionId === CHILD_ID)!;
  act(() => result.current.selectChild(child));
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(mocks.workspaceQuery, {
    data: WORKSPACE_RESPONSE,
    dataUpdatedAt: 1,
    isLoading: false,
    isError: false,
    isFetching: false,
    isSuccess: true,
  });
  Object.assign(mocks.parentQuery, {
    data: PARENT_RESPONSE,
    dataUpdatedAt: 1,
    isLoading: false,
    isError: false,
    isFetching: false,
    isSuccess: true,
  });
  Object.assign(mocks.sessionsQuery, {
    data: undefined,
    isLoading: false,
    isError: false,
    isFetching: false,
  });
  mocks.workspaceQuery.refetch.mockResolvedValue({ data: WORKSPACE_RESPONSE });
  mocks.parentQuery.refetch.mockResolvedValue({ data: PARENT_RESPONSE });
  mocks.sessionsQuery.refetch.mockResolvedValue({ data: [] });
  mocks.openWorkspaceSession.mockResolvedValue({ result: "activated" });

  useAgentsPaneNavigationStore.setState({ routesByWorkspaceId: {} });
  useSessionDirectoryStore.getState().clearEntries();
  useSessionSelectionStore.getState().clearSelection();
  useSessionSelectionStore.getState().activateWorkspace({
    logicalWorkspaceId: "logical-workspace",
    workspaceId: WORKSPACE_ID,
    initialActiveSessionId: "main-session",
  });
  installMappedChild();
});

afterEach(() => {
  cleanup();
  useAgentsPaneNavigationStore.setState({ routesByWorkspaceId: {} });
  useSessionDirectoryStore.getState().clearEntries();
  useSessionSelectionStore.getState().clearSelection();
});

describe("useAgentsPane", () => {
  it("drills overview to cluster to durable child detail without changing the active main session", () => {
    const { result } = renderHook(() => useAgentsPane({ workspaceId: WORKSPACE_ID }));
    const parent = result.current.overviewModel?.parents[0];
    expect(parent?.sessionId).toBe(PARENT_ID);

    act(() => result.current.selectParent(parent!));
    expect(result.current.route).toEqual({
      kind: "cluster",
      parentDurableId: PARENT_ID,
    });

    const child = result.current.focusedParent?.groups
      .flatMap((group) => group.children)
      .find((entry) => entry.sessionId === CHILD_ID);
    act(() => result.current.selectChild(child!));

    expect(result.current.route).toEqual({
      kind: "detail",
      parentDurableId: PARENT_ID,
      childDurableId: CHILD_ID,
    });
    expect(result.current.selectedClientSessionId).toBe(CLIENT_CHILD_ID);
    expect(useSessionSelectionStore.getState().activeSessionId).toBe("main-session");
    expect(mocks.openWorkspaceSession).not.toHaveBeenCalled();
  });

  it("carries a row action into the exact detail route without selecting a main tab", () => {
    const { result } = renderHook(() => useAgentsPane({ workspaceId: WORKSPACE_ID }));
    act(() => result.current.selectParent(result.current.overviewModel!.parents[0]!));
    const child = result.current.focusedParent!.groups
      .flatMap((group) => group.children)
      .find((entry) => entry.sessionId === CHILD_ID)!;

    act(() => result.current.requestChildAction(child, "promote"));

    expect(result.current.route).toEqual({
      kind: "detail",
      parentDurableId: PARENT_ID,
      childDurableId: CHILD_ID,
    });
    expect(result.current.actionRequest).toMatchObject({
      parentSessionId: PARENT_ID,
      childSessionId: CHILD_ID,
      action: "promote",
    });
    expect(useSessionSelectionStore.getState().activeSessionId).toBe("main-session");
  });

  it("distinguishes initial loading/error while preserving good data during background failure", () => {
    Object.assign(mocks.workspaceQuery, {
      data: undefined,
      isLoading: true,
      isError: false,
      isFetching: true,
    });
    const rendered = renderHook(() => useAgentsPane({ workspaceId: WORKSPACE_ID }));
    expect(rendered.result.current.initialLoading).toBe(true);
    expect(rendered.result.current.initialError).toBeNull();
    expect(rendered.result.current.overviewModel).toBeNull();

    act(() => {
      Object.assign(mocks.workspaceQuery, {
        isLoading: false,
        isError: true,
        isFetching: false,
      });
      rendered.rerender();
    });
    expect(rendered.result.current.initialError).toBe("Agents are unavailable.");

    act(() => {
      Object.assign(mocks.workspaceQuery, {
        data: WORKSPACE_RESPONSE,
        isError: true,
        isFetching: true,
      });
      rendered.rerender();
    });
    expect(rendered.result.current.initialLoading).toBe(false);
    expect(rendered.result.current.initialError).toBeNull();
    expect(rendered.result.current.backgroundRefreshing).toBe(true);
    expect(rendered.result.current.overviewModel?.parents[0]?.sessionId)
      .toBe(PARENT_ID);
  });

  it("shows initial loading while the no-data workspace roster is paused", () => {
    Object.assign(mocks.workspaceQuery, {
      data: undefined,
      isLoading: false,
      isError: false,
      isFetching: false,
    });

    const { result } = renderHook(() => useAgentsPane({ workspaceId: WORKSPACE_ID }));

    expect(result.current.overviewModel).toBeNull();
    expect(result.current.initialLoading).toBe(true);
    expect(result.current.initialError).toBeNull();
  });

  it("suppresses a successful Promote, roots the mapped session, and opens that exact ordinary tab", () => {
    const { result } = renderHook(() => useAgentsPane({ workspaceId: WORKSPACE_ID }));
    act(() => result.current.selectParent(result.current.overviewModel!.parents[0]!));

    act(() => result.current.handlePromoted(promotion()));

    expect(allOverviewChildIds(result.current.overviewModel)).toEqual([SIBLING_ID]);
    expect(useSessionDirectoryStore.getState().entriesById[CLIENT_CHILD_ID]?.sessionRelationship)
      .toEqual({ kind: "root" });
    expect(useSessionDirectoryStore.getState().promotedRootSessionIds).toEqual(
      new Set([CHILD_ID, CLIENT_CHILD_ID]),
    );
    expect(mocks.openWorkspaceSession).toHaveBeenCalledTimes(1);
    expect(mocks.openWorkspaceSession).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      sessionId: CLIENT_CHILD_ID,
      forceWorkspaceSelection: false,
    });
  });

  it("converges a Promote 404 only when the child left the roster and exists as an ordinary session", async () => {
    mocks.workspaceQuery.refetch.mockResolvedValueOnce({
      data: { parents: [] },
      isSuccess: true,
    });
    mocks.sessionsQuery.refetch.mockResolvedValueOnce({
      data: [{ id: CHILD_ID }],
      isSuccess: true,
    });
    const { result } = renderHook(() => useAgentsPane({ workspaceId: WORKSPACE_ID }));
    openChildDetail(result);

    await act(async () => {
      await result.current.handleLifecycleError(failure());
    });

    expect(result.current.lifecycleError).toBeNull();
    expect(allOverviewChildIds(result.current.overviewModel)).toEqual([SIBLING_ID]);
    expect(useSessionDirectoryStore.getState().entriesById[CLIENT_CHILD_ID]?.sessionRelationship)
      .toEqual({ kind: "root" });
    expect(useSessionDirectoryStore.getState().promotedRootSessionIds).toEqual(
      new Set([CHILD_ID, CLIENT_CHILD_ID]),
    );
    expect(mocks.openWorkspaceSession).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      sessionId: CLIENT_CHILD_ID,
      forceWorkspaceSelection: false,
    });
  });

  it.each([
    {
      label: "the durable child is still linked",
      rosterData: WORKSPACE_RESPONSE,
      sessionData: [{ id: CHILD_ID }],
    },
    {
      label: "the ordinary session is absent",
      rosterData: { parents: [] },
      sessionData: [],
    },
  ])("keeps a Promote 404 as an error when $label", async ({
    rosterData,
    sessionData,
  }) => {
    mocks.workspaceQuery.refetch.mockResolvedValueOnce({
      data: rosterData,
      isSuccess: true,
    });
    mocks.sessionsQuery.refetch.mockResolvedValueOnce({
      data: sessionData,
      isSuccess: true,
    });
    const { result } = renderHook(() => useAgentsPane({ workspaceId: WORKSPACE_ID }));
    openChildDetail(result);

    await act(async () => {
      await result.current.handleLifecycleError(failure());
    });

    expect(result.current.lifecycleError).toBe("The durable child was not found.");
    expect(allOverviewChildIds(result.current.overviewModel))
      .toEqual([CHILD_ID, SIBLING_ID]);
    expect(useSessionDirectoryStore.getState().entriesById[CLIENT_CHILD_ID]?.sessionRelationship.kind)
      .toBe("subagent_child");
    expect(mocks.openWorkspaceSession).not.toHaveBeenCalled();
  });

  it("never applies Promote convergence to a non-Promote 404", async () => {
    mocks.workspaceQuery.refetch.mockResolvedValueOnce({ data: { parents: [] } });
    mocks.sessionsQuery.refetch.mockResolvedValueOnce({ data: [{ id: CHILD_ID }] });
    const { result } = renderHook(() => useAgentsPane({ workspaceId: WORKSPACE_ID }));
    openChildDetail(result);

    await act(async () => {
      await result.current.handleLifecycleError(failure({ action: "close" }));
    });

    expect(result.current.lifecycleError).toBe("The durable child was not found.");
    expect(mocks.sessionsQuery.refetch).not.toHaveBeenCalled();
    expect(mocks.openWorkspaceSession).not.toHaveBeenCalled();
    expect(useSessionDirectoryStore.getState().entriesById[CLIENT_CHILD_ID]?.sessionRelationship)
      .toMatchObject({ kind: "subagent_child" });
  });

  it("does not converge Promote from stale sessions data when the sessions refetch fails", async () => {
    mocks.workspaceQuery.refetch.mockResolvedValueOnce({
      data: { parents: [] },
      isSuccess: true,
    });
    mocks.sessionsQuery.refetch.mockResolvedValueOnce({
      data: [{ id: CHILD_ID }],
      isSuccess: false,
      isError: true,
    });
    const { result } = renderHook(() => useAgentsPane({ workspaceId: WORKSPACE_ID }));
    openChildDetail(result);

    await act(async () => {
      await result.current.handleLifecycleError(failure());
    });

    expect(result.current.lifecycleError).toBe("The durable child was not found.");
    expect(mocks.openWorkspaceSession).not.toHaveBeenCalled();
  });

  it("repairs stale detail from settled focused truth even when the workspace roster failed", () => {
    useAgentsPaneNavigationStore.getState().openDetail(
      WORKSPACE_ID,
      PARENT_ID,
      CHILD_ID,
    );
    Object.assign(mocks.workspaceQuery, {
      data: undefined,
      isError: true,
      isFetching: false,
    });
    Object.assign(mocks.parentQuery, {
      data: { parent: ROSTER.parent, children: [] },
      isError: false,
      isFetching: false,
    });

    const { result } = renderHook(() => useAgentsPane({ workspaceId: WORKSPACE_ID }));

    expect(result.current.route).toEqual({ kind: "overview" });
  });

  it("repairs from newer workspace truth instead of an older settled parent cache", () => {
    useAgentsPaneNavigationStore.getState().openDetail(
      WORKSPACE_ID,
      PARENT_ID,
      CHILD_ID,
    );
    Object.assign(mocks.workspaceQuery, {
      data: { parents: [] },
      dataUpdatedAt: 12,
      isError: false,
      isFetching: false,
      isSuccess: true,
    });
    Object.assign(mocks.parentQuery, {
      data: PARENT_RESPONSE,
      dataUpdatedAt: 11,
      isError: false,
      isFetching: false,
      isSuccess: true,
    });

    const { result } = renderHook(() => useAgentsPane({ workspaceId: WORKSPACE_ID }));

    expect(result.current.route).toEqual({ kind: "overview" });
    expect(result.current.focusedLoading).toBe(false);
  });

  it("preserves detail while a newer focused roster is still refetching", () => {
    useAgentsPaneNavigationStore.getState().openDetail(WORKSPACE_ID, PARENT_ID, CHILD_ID);
    Object.assign(mocks.workspaceQuery, { data: { parents: [] }, dataUpdatedAt: 10 });
    Object.assign(mocks.parentQuery, {
      data: PARENT_RESPONSE, dataUpdatedAt: 11, isFetching: true,
    });

    const { result } = renderHook(() => useAgentsPane({ workspaceId: WORKSPACE_ID }));

    expect(result.current.route).toEqual(
      { kind: "detail", parentDurableId: PARENT_ID, childDurableId: CHILD_ID },
    );
    expect(result.current.selectedChild?.agent.identity.sessionId).toBe(CHILD_ID);
  });

  it("preserves a new detail route while its invalidated workspace roster is refetching", () => {
    useAgentsPaneNavigationStore.getState().openDetail(
      WORKSPACE_ID,
      PARENT_ID,
      "new-child",
    );
    Object.assign(mocks.workspaceQuery, {
      data: WORKSPACE_RESPONSE,
      isError: false,
      isFetching: true,
    });
    Object.assign(mocks.parentQuery, {
      data: undefined,
      isError: false,
      isFetching: true,
    });

    const { result } = renderHook(() => useAgentsPane({ workspaceId: WORKSPACE_ID }));

    expect(result.current.route).toEqual({
      kind: "detail",
      parentDurableId: PARENT_ID,
      childDurableId: "new-child",
    });
  });

  it("preserves a detail route while both roster queries are paused without data", () => {
    useAgentsPaneNavigationStore.getState().openDetail(
      WORKSPACE_ID,
      PARENT_ID,
      "paused-child",
    );
    Object.assign(mocks.workspaceQuery, {
      data: undefined,
      isError: false,
      isFetching: false,
    });
    Object.assign(mocks.parentQuery, {
      data: undefined,
      isError: false,
      isFetching: false,
    });

    const { result } = renderHook(() => useAgentsPane({ workspaceId: WORKSPACE_ID }));

    expect(result.current.route).toEqual({
      kind: "detail",
      parentDurableId: PARENT_ID,
      childDurableId: "paused-child",
    });
  });

  it("refetches focused parent truth after a lifecycle race", async () => {
    const closedChild = {
      ...CHILD_ENTRY,
      agent: agent(CHILD_ID, "Primary worker", "closed"),
    };
    const closedWorkspaceData = {
      parents: [{ ...ROSTER, children: [closedChild, SIBLING_ENTRY] }],
    };
    const closedParentData = {
      parent: ROSTER.parent,
      children: [closedChild, SIBLING_ENTRY],
    };
    mocks.workspaceQuery.refetch.mockImplementationOnce(async () => {
      mocks.workspaceQuery.data = closedWorkspaceData;
      return { data: closedWorkspaceData };
    });
    mocks.parentQuery.refetch.mockImplementationOnce(async () => {
      mocks.parentQuery.data = closedParentData;
      return { data: closedParentData };
    });
    const rendered = renderHook(() => useAgentsPane({ workspaceId: WORKSPACE_ID }));
    const { result } = rendered;
    openChildDetail(result);

    await act(async () => {
      await result.current.handleLifecycleError(failure({
        action: "promote",
        kind: "closed_race",
        status: 409,
        code: "SUBAGENT_OPEN_REQUIRED",
      }));
    });
    rendered.rerender();

    expect(mocks.parentQuery.refetch).toHaveBeenCalledTimes(1);
    expect(mocks.workspaceQuery.refetch).toHaveBeenCalledTimes(1);
    expect(result.current.selectedChild?.agent.status.presentation).toBe("closed");
  });

});
