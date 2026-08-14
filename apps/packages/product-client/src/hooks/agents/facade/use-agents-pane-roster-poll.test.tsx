// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  return {
    useWorkspaceSubagentsQuery: vi.fn(query),
    useSessionSubagentsQuery: vi.fn(query),
    useWorkspaceSessionsQuery: vi.fn(query),
  };
});

vi.mock("@anyharness/sdk-react", () => ({
  useWorkspaceSubagentsQuery: mocks.useWorkspaceSubagentsQuery,
  useSessionSubagentsQuery: mocks.useSessionSubagentsQuery,
  useWorkspaceSessionsQuery: mocks.useWorkspaceSessionsQuery,
}));

vi.mock("#product/hooks/workspaces/workflows/use-workspace-activation-workflow", () => ({
  useWorkspaceActivationWorkflow: () => ({
    openWorkspaceSession: vi.fn(),
  }),
}));

const WORKSPACE_ID = "workspace-agents-pane";

beforeEach(() => {
  vi.clearAllMocks();
  useAgentsPaneNavigationStore.setState({ routesByWorkspaceId: {} });
  useSessionDirectoryStore.getState().clearEntries();
  useSessionSelectionStore.getState().clearSelection();
  useSessionSelectionStore.getState().activateWorkspace({
    logicalWorkspaceId: "logical-workspace",
    workspaceId: WORKSPACE_ID,
    initialActiveSessionId: "main-session",
  });
});

afterEach(() => {
  cleanup();
  useAgentsPaneNavigationStore.setState({ routesByWorkspaceId: {} });
  useSessionDirectoryStore.getState().clearEntries();
  useSessionSelectionStore.getState().clearSelection();
});

describe("useAgentsPane roster staleness backstop", () => {
  it("configures a poll interval and window-focus refetch for both roster queries while the pane is open", () => {
    renderHook(() => useAgentsPane({ workspaceId: WORKSPACE_ID, isOpen: true }));

    const workspaceRosterOptions = mocks.useWorkspaceSubagentsQuery.mock
      .calls.at(-1)?.[0];
    expect(workspaceRosterOptions).toMatchObject({
      refetchInterval: 15_000,
      refetchOnWindowFocus: true,
    });

    const parentRosterOptions = mocks.useSessionSubagentsQuery.mock
      .calls.at(-1)?.[1];
    expect(parentRosterOptions).toMatchObject({
      refetchInterval: 15_000,
      refetchOnWindowFocus: true,
    });
  });

  it("does not poll or refetch on focus while the pane is closed", () => {
    renderHook(() => useAgentsPane({ workspaceId: WORKSPACE_ID, isOpen: false }));

    const workspaceRosterOptions = mocks.useWorkspaceSubagentsQuery.mock
      .calls.at(-1)?.[0];
    expect(workspaceRosterOptions).toMatchObject({
      refetchInterval: false,
      refetchOnWindowFocus: false,
    });

    const parentRosterOptions = mocks.useSessionSubagentsQuery.mock
      .calls.at(-1)?.[1];
    expect(parentRosterOptions).toMatchObject({
      refetchInterval: false,
      refetchOnWindowFocus: false,
    });
  });

  it("defaults to the open (polling) configuration when a caller does not track pane visibility", () => {
    renderHook(() => useAgentsPane({ workspaceId: WORKSPACE_ID }));

    const workspaceRosterOptions = mocks.useWorkspaceSubagentsQuery.mock
      .calls.at(-1)?.[0];
    expect(workspaceRosterOptions).toMatchObject({
      refetchInterval: 15_000,
      refetchOnWindowFocus: true,
    });
  });
});
