// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentOperationsAgent,
  SessionSubagentsResponse,
  SubagentParentRoster,
  WorkspaceSubagentsResponse,
} from "@anyharness/sdk";
import { useAgentsPane } from "#product/hooks/agents/facade/use-agents-pane";
import { useAgentsPaneNavigationStore } from "#product/stores/agents/agents-pane-navigation-store";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";

const mocks = vi.hoisted(() => {
  const query = () => ({
    data: undefined as unknown,
    dataUpdatedAt: 10,
    isLoading: false,
    isError: false,
    isFetching: false,
    isSuccess: true,
    refetch: vi.fn(),
  });
  return {
    workspaceQuery: query(),
    parentQuery: query(),
    sessionsQuery: query(),
  };
});

vi.mock("@anyharness/sdk-react", () => ({
  useWorkspaceSubagentsQuery: () => mocks.workspaceQuery,
  useSessionSubagentsQuery: () => mocks.parentQuery,
  useWorkspaceSessionsQuery: () => mocks.sessionsQuery,
}));

vi.mock("#product/hooks/workspaces/workflows/use-workspace-activation-workflow", () => ({
  useWorkspaceActivationWorkflow: () => ({ openWorkspaceSession: vi.fn() }),
}));

const WORKSPACE_ID = "workspace-agents-pane";
const PARENT_ID = "parent-durable";
const CHILD_ID = "child-durable";
const CLIENT_CHILD_ID = "child-client";

function agent(
  sessionId: string,
  presentation: AgentOperationsAgent["status"]["presentation"],
): AgentOperationsAgent {
  return {
    capabilities: [],
    configuration: { agentKind: "claude" },
    createdAt: "2026-08-11T00:00:00Z",
    identity: { runtimeId: "runtime-1", sessionId },
    parent: null,
    role: "subagent",
    status: {
      execution: presentation === "closed"
        ? "closed"
        : presentation === "running" ? "running" : "idle",
      hasLiveActor: presentation === "running",
      presentation,
    },
    title: sessionId === PARENT_ID ? "Parent" : "Worker",
    updatedAt: "2026-08-11T00:00:00Z",
    workspace: { runtimeId: "runtime-1", workspaceId: WORKSPACE_ID },
  };
}

function setRoster(
  presentation: AgentOperationsAgent["status"]["presentation"],
  dataUpdatedAt: number,
) {
  const child = {
    agent: agent(CHILD_ID, presentation),
    latestCompletion: null,
    relationship: {
      childSessionId: CHILD_ID,
      createdAt: "2026-08-11T00:00:00Z",
      label: "Worker",
      parentSessionId: PARENT_ID,
      sessionLinkId: "link-child",
    },
  };
  const roster: SubagentParentRoster = {
    parent: agent(PARENT_ID, "running"),
    children: [child],
  };
  mocks.workspaceQuery.data = { parents: [roster] } satisfies WorkspaceSubagentsResponse;
  mocks.parentQuery.data = {
    parent: roster.parent,
    children: roster.children,
  } satisfies SessionSubagentsResponse;
  mocks.workspaceQuery.dataUpdatedAt = dataUpdatedAt;
  mocks.parentQuery.dataUpdatedAt = dataUpdatedAt;
}

function installMappedChild() {
  useSessionDirectoryStore.getState().upsertEntry({
    sessionId: CLIENT_CHILD_ID,
    materializedSessionId: CHILD_ID,
    workspaceId: WORKSPACE_ID,
    agentKind: "claude",
    sessionRelationship: {
      kind: "subagent_child",
      parentSessionId: PARENT_ID,
      sessionLinkId: "link-child",
      relation: "subagent",
      workspaceId: WORKSPACE_ID,
    },
  });
}

function openDetail(result: { current: ReturnType<typeof useAgentsPane> }) {
  act(() => result.current.selectParent(result.current.overviewModel!.parents[0]!));
  act(() => result.current.selectChild(result.current.focusedParent!.children[0]!));
}

function focusedChild(result: { current: ReturnType<typeof useAgentsPane> }) {
  return result.current.focusedParent?.children[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(mocks.workspaceQuery, {
    dataUpdatedAt: 10,
    isError: false,
    isFetching: false,
    isSuccess: true,
  });
  Object.assign(mocks.parentQuery, {
    dataUpdatedAt: 10,
    isError: false,
    isFetching: false,
    isSuccess: true,
  });
  setRoster("available", 10);
  useAgentsPaneNavigationStore.setState({ routesByWorkspaceId: {} });
  useSessionDirectoryStore.getState().clearEntries();
  installMappedChild();
});

afterEach(() => {
  cleanup();
  useAgentsPaneNavigationStore.setState({ routesByWorkspaceId: {} });
  useSessionDirectoryStore.getState().clearEntries();
});

describe("useAgentsPane lifecycle presentation truth", () => {
  it("keeps accepted Close truth after Back while both roster props are stale", () => {
    const rendered = renderHook(() => useAgentsPane({ workspaceId: WORKSPACE_ID }));
    openDetail(rendered.result);

    act(() => rendered.result.current.handleLifecycleSuccess({
      ok: true,
      agent: agent(CHILD_ID, "closed"),
      parentSessionId: PARENT_ID,
      childSessionId: CHILD_ID,
      clientSessionId: CLIENT_CHILD_ID,
    }));
    act(() => rendered.result.current.back());

    expect(focusedChild(rendered.result)).toMatchObject({
      group: "closed",
      actions: ["open"],
    });
  });

  it("yields Open Running truth to a later settled Available roster", () => {
    setRoster("closed", 10);
    const rendered = renderHook(() => useAgentsPane({ workspaceId: WORKSPACE_ID }));
    openDetail(rendered.result);

    act(() => rendered.result.current.handleLifecycleSuccess({
      ok: true,
      agent: agent(CHILD_ID, "running"),
      presentation: "running",
      parentSessionId: PARENT_ID,
      childSessionId: CHILD_ID,
      clientSessionId: CLIENT_CHILD_ID,
    }));
    act(() => rendered.result.current.back());
    expect(focusedChild(rendered.result)?.group).toBe("running");

    act(() => {
      setRoster("available", 11);
      mocks.workspaceQuery.dataUpdatedAt = 10;
      mocks.workspaceQuery.isFetching = true;
      mocks.parentQuery.isFetching = true;
      rendered.rerender();
    });
    expect(focusedChild(rendered.result)?.group).toBe("running");
    act(() => {
      mocks.parentQuery.isFetching = false;
      rendered.rerender();
    });
    expect(focusedChild(rendered.result)?.group).toBe("available");
  });

  it("does not clear against a pre-matched cache before a newer result", () => {
    setRoster("running", 10);
    const rendered = renderHook(() => useAgentsPane({ workspaceId: WORKSPACE_ID }));
    openDetail(rendered.result);

    act(() => rendered.result.current.handleLifecycleSuccess({
      ok: true,
      agent: agent(CHILD_ID, "running"),
      presentation: "running",
      parentSessionId: PARENT_ID,
      childSessionId: CHILD_ID,
      clientSessionId: CLIENT_CHILD_ID,
    }));
    act(() => rendered.result.current.back());
    act(() => {
      setRoster("closed", 10);
      rendered.rerender();
    });
    expect(focusedChild(rendered.result)?.group).toBe("running");

    act(() => {
      setRoster("closed", 11);
      mocks.parentQuery.dataUpdatedAt = 10;
      rendered.rerender();
    });
    expect(focusedChild(rendered.result)?.group).toBe("closed");
  });
});
