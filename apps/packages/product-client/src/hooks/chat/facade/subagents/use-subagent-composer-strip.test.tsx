// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentOperationsAgent,
  SessionSubagentsResponse,
  SubagentRosterEntry,
} from "@anyharness/sdk";
import { useSubagentComposerStrip } from "#product/hooks/chat/facade/subagents/use-subagent-composer-strip";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";

const mocks = vi.hoisted(() => ({
  activeSessionId: "client-parent" as string | null,
  activeWorkspaceId: "workspace-1" as string | null,
  query: vi.fn(),
  openAgentsPaneTarget: vi.fn(),
  resolveAgentsPaneTarget: vi.fn(),
  openWorkspaceSession: vi.fn(),
}));

vi.mock("@anyharness/sdk-react", () => ({
  useSessionSubagentsQuery: (
    sessionId: string | null | undefined,
    options: unknown,
  ) => mocks.query(sessionId, options),
}));

vi.mock("#product/hooks/chat/derived/use-active-session-identity", () => ({
  useActiveSessionId: () => mocks.activeSessionId,
  useActiveSessionWorkspaceId: () => mocks.activeWorkspaceId,
}));

vi.mock("#product/hooks/agents/workflows/use-agents-pane-navigation-actions", () => ({
  useAgentsPaneNavigationActions: () => ({
    openAgentsPaneTarget: mocks.openAgentsPaneTarget,
    resolveAgentsPaneTarget: mocks.resolveAgentsPaneTarget,
  }),
}));

vi.mock("#product/hooks/workspaces/workflows/use-workspace-activation-workflow", () => ({
  useWorkspaceActivationWorkflow: () => ({
    openWorkspaceSession: mocks.openWorkspaceSession,
  }),
}));

const PARENT_ID = "parent-durable";
const CHILD_ID = "child-durable";
const SIBLING_ID = "sibling-durable";
const NESTED_ID = "nested-durable";

function agent(
  sessionId: string,
  parentSessionId: string | null,
): AgentOperationsAgent {
  return {
    capabilities: [],
    configuration: { agentKind: "codex" },
    createdAt: "2026-08-11T00:00:00Z",
    identity: { runtimeId: "runtime-1", sessionId },
    parent: parentSessionId
      ? { runtimeId: "runtime-1", sessionId: parentSessionId }
      : null,
    role: parentSessionId ? "subagent" : "ordinary",
    status: {
      execution: "idle",
      hasLiveActor: true,
      presentation: "available",
    },
    title: sessionId,
    updatedAt: "2026-08-11T00:00:00Z",
    workspace: { runtimeId: "runtime-1", workspaceId: "workspace-1" },
  };
}

function child(sessionId: string): SubagentRosterEntry {
  return {
    agent: agent(sessionId, PARENT_ID),
    latestCompletion: null,
    relationship: {
      childSessionId: sessionId,
      createdAt: "2026-08-11T00:00:00Z",
      label: sessionId,
      parentSessionId: PARENT_ID,
      sessionLinkId: `link-${sessionId}`,
    },
  };
}

const CHILD = child(CHILD_ID);
const SIBLING = child(SIBLING_ID);
const PARENT_RESPONSE: SessionSubagentsResponse = {
  parent: agent(PARENT_ID, null),
  children: [CHILD, SIBLING],
};
const CHILD_RESPONSE: SessionSubagentsResponse = {
  parent: agent(CHILD_ID, PARENT_ID),
  children: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.activeSessionId = "client-parent";
  mocks.activeWorkspaceId = "workspace-1";
  mocks.query.mockImplementation((sessionId: string | null | undefined) => ({
    data: sessionId === PARENT_ID
      ? PARENT_RESPONSE
      : sessionId === CHILD_ID
        ? CHILD_RESPONSE
        : undefined,
  }));
  mocks.resolveAgentsPaneTarget.mockImplementation((target: {
    childSessionId?: string | null;
    workspaceId: string;
  }) => ({
    classification: "subagent" as const,
    clientSessionId: target.childSessionId ?? null,
    relationship: null,
    workspaceId: target.workspaceId,
  }));
  useSessionDirectoryStore.getState().upsertEntry({
    sessionId: "client-parent",
    materializedSessionId: PARENT_ID,
    workspaceId: "workspace-1",
    agentKind: "codex",
    sessionRelationship: { kind: "root" },
  });
});

afterEach(() => {
  cleanup();
  useSessionDirectoryStore.getState().clearEntries();
});

describe("useSubagentComposerStrip", () => {
  it("opens authoritative roster children in Agents detail and records the durable relationship", () => {
    useSessionDirectoryStore.getState().upsertEntry({
      sessionId: "client-child",
      materializedSessionId: CHILD_ID,
      workspaceId: "workspace-1",
      agentKind: "codex",
      sessionRelationship: { kind: "root" },
    });
    const { result } = renderHook(() => useSubagentComposerStrip());
    expect(result.current?.rows[0]?.statusLabel).toBe("Available");

    act(() => result.current?.openSubagent(CHILD_ID));

    expect(mocks.openAgentsPaneTarget).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      parentSessionId: PARENT_ID,
      childSessionId: CHILD_ID,
      authoritativeCurrentRosterSubagent: true,
    });
    expect(
      useSessionDirectoryStore.getState().entriesById["client-child"]?.sessionRelationship,
    ).toEqual({
      kind: "subagent_child",
      parentSessionId: PARENT_ID,
      sessionLinkId: `link-${CHILD_ID}`,
      relation: "subagent",
      workspaceId: "workspace-1",
    });

    act(() => result.current?.openCluster());
    expect(mocks.openAgentsPaneTarget).toHaveBeenLastCalledWith({
      workspaceId: "workspace-1",
      parentSessionId: PARENT_ID,
    });
  });

  it("uses the queried parent identity for a child-context cluster and sibling detail", () => {
    mocks.activeSessionId = "client-child";
    useSessionDirectoryStore.getState().upsertEntry({
      sessionId: "client-child",
      materializedSessionId: CHILD_ID,
      workspaceId: "workspace-1",
      agentKind: "codex",
      sessionRelationship: {
        kind: "subagent_child",
        parentSessionId: PARENT_ID,
        relation: "subagent",
        workspaceId: "workspace-1",
      },
    });
    const { result } = renderHook(() => useSubagentComposerStrip());

    act(() => result.current?.openCluster());
    expect(mocks.openAgentsPaneTarget).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      parentSessionId: PARENT_ID,
    });

    act(() => result.current?.openSubagent(SIBLING_ID));
    expect(mocks.openAgentsPaneTarget).toHaveBeenLastCalledWith({
      workspaceId: "workspace-1",
      parentSessionId: PARENT_ID,
      childSessionId: SIBLING_ID,
      authoritativeCurrentRosterSubagent: true,
    });
  });

  it("uses the active durable session as parent when its parent roster is unavailable", () => {
    mocks.activeSessionId = "client-child";
    useSessionDirectoryStore.getState().upsertEntry({
      sessionId: "client-child",
      materializedSessionId: CHILD_ID,
      workspaceId: "workspace-1",
      agentKind: "codex",
      sessionRelationship: {
        kind: "subagent_child",
        parentSessionId: PARENT_ID,
        relation: "subagent",
        workspaceId: "workspace-1",
      },
    });
    const nested = {
      ...child(NESTED_ID),
      agent: agent(NESTED_ID, CHILD_ID),
      relationship: {
        ...child(NESTED_ID).relationship,
        parentSessionId: CHILD_ID,
      },
    };
    mocks.query.mockImplementation((sessionId: string | null | undefined) => ({
      data: sessionId === CHILD_ID
        ? { ...CHILD_RESPONSE, children: [nested] }
        : undefined,
    }));

    const { result } = renderHook(() => useSubagentComposerStrip());
    act(() => result.current?.openSubagent(NESTED_ID));

    expect(mocks.openAgentsPaneTarget).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      parentSessionId: CHILD_ID,
      childSessionId: NESTED_ID,
      authoritativeCurrentRosterSubagent: true,
    });

    act(() => result.current?.openCluster());
    expect(mocks.openAgentsPaneTarget).toHaveBeenLastCalledWith({
      workspaceId: "workspace-1",
      parentSessionId: CHILD_ID,
    });

    act(() => result.current?.openParent());
    expect(mocks.openAgentsPaneTarget).toHaveBeenLastCalledWith({
      workspaceId: "workspace-1",
      parentSessionId: PARENT_ID,
    });
  });

  it("filters a promoted child from stale roster data while offline", () => {
    useSessionDirectoryStore.getState().upsertEntry({
      sessionId: "client-child",
      materializedSessionId: CHILD_ID,
      workspaceId: "workspace-1",
      agentKind: "codex",
      sessionRelationship: {
        kind: "subagent_child",
        parentSessionId: PARENT_ID,
        relation: "subagent",
        workspaceId: "workspace-1",
      },
    });
    useSessionDirectoryStore.getState().markSessionPromoted(
      [CHILD_ID, "client-child"],
      "workspace-1",
    );

    const { result } = renderHook(() => useSubagentComposerStrip());

    expect(result.current?.rows.map((row) => row.childSessionId)).toEqual([SIBLING_ID]);
  });

  it("detaches an active promoted session from its stale parent and siblings", () => {
    mocks.activeSessionId = "client-child";
    useSessionDirectoryStore.getState().upsertEntry({
      sessionId: "client-child",
      materializedSessionId: CHILD_ID,
      workspaceId: "workspace-1",
      agentKind: "codex",
      sessionRelationship: {
        kind: "subagent_child",
        parentSessionId: PARENT_ID,
        relation: "subagent",
        workspaceId: "workspace-1",
      },
    });
    useSessionDirectoryStore.getState().markSessionPromoted(
      [CHILD_ID, "client-child"],
      "workspace-1",
    );

    const { result } = renderHook(() => useSubagentComposerStrip());

    expect(result.current).toBeNull();
    expect(mocks.query).not.toHaveBeenCalledWith(PARENT_ID, expect.anything());
  });
});
