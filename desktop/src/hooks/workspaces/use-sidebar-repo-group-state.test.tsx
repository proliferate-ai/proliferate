// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LogicalWorkspace } from "@/lib/domain/workspaces/logical-workspaces";
import {
  buildGroups,
  makeLocalLogicalWorkspace,
} from "@/lib/domain/workspaces/sidebar-test-fixtures";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import {
  WORKSPACE_SIDEBAR_SHOW_MORE_DEFAULTS,
  useWorkspaceSidebarShowMoreStore,
} from "@/stores/workspaces/workspace-sidebar-show-more-store";
import { useSidebarRepoGroupState } from "./use-sidebar-repo-group-state";

const mocks = vi.hoisted(() => ({
  logicalWorkspaces: [] as LogicalWorkspace[],
}));

vi.mock("@/hooks/workspaces/use-logical-workspaces", () => ({
  useLogicalWorkspaces: () => ({
    logicalWorkspaces: mocks.logicalWorkspaces,
    isLoading: false,
  }),
}));

describe("useSidebarRepoGroupState", () => {
  beforeEach(() => {
    useWorkspaceUiStore.setState({
      collapsedRepoGroups: [],
    });
    useWorkspaceSidebarShowMoreStore.setState({
      ...WORKSPACE_SIDEBAR_SHOW_MORE_DEFAULTS,
    });
    useSessionSelectionStore.setState({
      pendingWorkspaceEntry: null,
      selectedWorkspaceId: null,
      workspaceSelectionNonce: 0,
      workspaceArrivalEvent: null,
      activeSessionId: null,
    });
    mocks.logicalWorkspaces = [];
  });

  afterEach(() => {
    cleanup();
  });

  it("does not re-expand after Show less during same-selection recomputation", async () => {
    const logicalWorkspaces = makeRepoWorkspaces(7);
    const selectedLogicalWorkspaceId = "worktree-6";
    const selectedWorkspaceId = logicalWorkspaces[6]!.localWorkspace!.id;
    mocks.logicalWorkspaces = logicalWorkspaces;
    useSessionSelectionStore.setState({
      selectedWorkspaceId,
      workspaceSelectionNonce: 1,
    });

    const rendered = renderRepoGroupState({
      logicalWorkspaces,
      selectedLogicalWorkspaceId,
      selectedWorkspaceId,
    });

    await waitFor(() => {
      expect(useWorkspaceSidebarShowMoreStore.getState().repoGroupsShownMore).toEqual([
        "/tmp/repo-a",
      ]);
    });

    act(() => {
      rendered.result.current.handleToggleRepoShowMore("/tmp/repo-a");
    });
    expect(useWorkspaceSidebarShowMoreStore.getState().repoGroupsShownMore).toEqual([]);

    rendered.rerender({
      groups: buildGroups({
        logicalWorkspaces,
        selectedLogicalWorkspaceId,
      }),
      selectedLogicalWorkspaceId,
      selectedWorkspaceId,
    });
    await flushEffects();

    expect(useWorkspaceSidebarShowMoreStore.getState().repoGroupsShownMore).toEqual([]);
  });

  it("can auto-reveal again after a real selection transition bumps the nonce", async () => {
    const logicalWorkspaces = makeRepoWorkspaces(7);
    const selectedLogicalWorkspaceId = "worktree-6";
    const selectedWorkspaceId = logicalWorkspaces[6]!.localWorkspace!.id;
    mocks.logicalWorkspaces = logicalWorkspaces;
    useSessionSelectionStore.setState({
      selectedWorkspaceId,
      workspaceSelectionNonce: 1,
    });

    const rendered = renderRepoGroupState({
      logicalWorkspaces,
      selectedLogicalWorkspaceId,
      selectedWorkspaceId,
    });
    await waitFor(() => {
      expect(useWorkspaceSidebarShowMoreStore.getState().repoGroupsShownMore).toEqual([
        "/tmp/repo-a",
      ]);
    });
    act(() => {
      rendered.result.current.handleToggleRepoShowMore("/tmp/repo-a");
      useSessionSelectionStore.setState({
        selectedWorkspaceId,
        workspaceSelectionNonce: 2,
      });
    });
    rendered.rerender({
      groups: buildGroups({
        logicalWorkspaces,
        selectedLogicalWorkspaceId,
      }),
      selectedLogicalWorkspaceId,
      selectedWorkspaceId,
    });

    await waitFor(() => {
      expect(useWorkspaceSidebarShowMoreStore.getState().repoGroupsShownMore).toEqual([
        "/tmp/repo-a",
      ]);
    });
  });

  it("ignores non-selection nonce bumps when selectedWorkspaceId is null", async () => {
    const logicalWorkspaces = makeRepoWorkspaces(7);
    const selectedLogicalWorkspaceId = "worktree-6";
    const selectedWorkspaceId = logicalWorkspaces[6]!.localWorkspace!.id;
    mocks.logicalWorkspaces = logicalWorkspaces;
    useSessionSelectionStore.setState({
      selectedWorkspaceId,
      workspaceSelectionNonce: 1,
    });

    const rendered = renderRepoGroupState({
      logicalWorkspaces,
      selectedLogicalWorkspaceId,
      selectedWorkspaceId,
    });
    await waitFor(() => {
      expect(useWorkspaceSidebarShowMoreStore.getState().repoGroupsShownMore).toEqual([
        "/tmp/repo-a",
      ]);
    });
    act(() => {
      rendered.result.current.handleToggleRepoShowMore("/tmp/repo-a");
      useSessionSelectionStore.setState({
        selectedWorkspaceId: null,
        workspaceSelectionNonce: 2,
      });
    });
    rendered.rerender({
      groups: buildGroups({
        logicalWorkspaces,
        selectedLogicalWorkspaceId,
      }),
      selectedLogicalWorkspaceId,
      selectedWorkspaceId: null,
    });
    await flushEffects();

    expect(useWorkspaceSidebarShowMoreStore.getState().repoGroupsShownMore).toEqual([]);
  });

  it("auto-reveals once when groups arrive after selection", async () => {
    const logicalWorkspaces = makeRepoWorkspaces(7);
    const selectedLogicalWorkspaceId = "worktree-6";
    const selectedWorkspaceId = logicalWorkspaces[6]!.localWorkspace!.id;
    mocks.logicalWorkspaces = logicalWorkspaces;
    useSessionSelectionStore.setState({
      selectedWorkspaceId,
      workspaceSelectionNonce: 1,
    });

    const rendered = renderRepoGroupState({
      logicalWorkspaces: [],
      selectedLogicalWorkspaceId,
      selectedWorkspaceId,
    });
    await flushEffects();
    expect(useWorkspaceSidebarShowMoreStore.getState().repoGroupsShownMore).toEqual([]);

    rendered.rerender({
      groups: buildGroups({
        logicalWorkspaces,
        selectedLogicalWorkspaceId,
      }),
      selectedLogicalWorkspaceId,
      selectedWorkspaceId,
    });

    await waitFor(() => {
      expect(useWorkspaceSidebarShowMoreStore.getState().repoGroupsShownMore).toEqual([
        "/tmp/repo-a",
      ]);
    });
  });

  it("preserves Show less through temporary under-cap group changes", async () => {
    const logicalWorkspaces = makeRepoWorkspaces(7);
    const selectedLogicalWorkspaceId = "worktree-6";
    const selectedWorkspaceId = logicalWorkspaces[6]!.localWorkspace!.id;
    mocks.logicalWorkspaces = logicalWorkspaces;
    useSessionSelectionStore.setState({
      selectedWorkspaceId,
      workspaceSelectionNonce: 1,
    });

    const rendered = renderRepoGroupState({
      logicalWorkspaces,
      selectedLogicalWorkspaceId,
      selectedWorkspaceId,
    });
    await waitFor(() => {
      expect(useWorkspaceSidebarShowMoreStore.getState().repoGroupsShownMore).toEqual([
        "/tmp/repo-a",
      ]);
    });
    act(() => {
      rendered.result.current.handleToggleRepoShowMore("/tmp/repo-a");
    });

    rendered.rerender({
      groups: buildGroups({
        logicalWorkspaces: logicalWorkspaces.slice(0, 5),
        selectedLogicalWorkspaceId,
      }),
      selectedLogicalWorkspaceId,
      selectedWorkspaceId,
    });
    await flushEffects();
    rendered.rerender({
      groups: buildGroups({
        logicalWorkspaces,
        selectedLogicalWorkspaceId,
      }),
      selectedLogicalWorkspaceId,
      selectedWorkspaceId,
    });
    await flushEffects();

    expect(useWorkspaceSidebarShowMoreStore.getState().repoGroupsShownMore).toEqual([]);
  });

  it("re-reveals the selected workspace after an auto-shown repo is collapsed and reopened", async () => {
    const logicalWorkspaces = makeRepoWorkspaces(7);
    const selectedLogicalWorkspaceId = "worktree-6";
    const selectedWorkspaceId = logicalWorkspaces[6]!.localWorkspace!.id;
    mocks.logicalWorkspaces = logicalWorkspaces;
    useSessionSelectionStore.setState({
      selectedWorkspaceId,
      workspaceSelectionNonce: 1,
    });

    const rendered = renderRepoGroupState({
      logicalWorkspaces,
      selectedLogicalWorkspaceId,
      selectedWorkspaceId,
    });
    await waitFor(() => {
      expect(useWorkspaceSidebarShowMoreStore.getState().repoGroupsShownMore).toEqual([
        "/tmp/repo-a",
      ]);
    });

    act(() => {
      rendered.result.current.handleToggleRepoCollapsed("/tmp/repo-a");
    });
    expect(useWorkspaceSidebarShowMoreStore.getState().repoGroupsShownMore).toEqual([]);
    expect(useWorkspaceSidebarShowMoreStore.getState().repoGroupsShowMoreClearedByCollapse)
      .toEqual(["/tmp/repo-a"]);
    await flushEffects();
    expect(useWorkspaceSidebarShowMoreStore.getState().repoGroupsShownMore).toEqual([]);

    act(() => {
      rendered.result.current.handleToggleRepoCollapsed("/tmp/repo-a");
    });

    await waitFor(() => {
      expect(useWorkspaceSidebarShowMoreStore.getState().repoGroupsShownMore).toEqual([
        "/tmp/repo-a",
      ]);
      expect(useWorkspaceSidebarShowMoreStore.getState().repoGroupsShowMoreClearedByCollapse)
        .toEqual([]);
    });
  });

  it("re-reveals the selected workspace after collapse-all is expanded again", async () => {
    const logicalWorkspaces = [
      ...makeRepoWorkspaces(7, "/tmp/repo-a", "repo-a"),
      ...makeRepoWorkspaces(7, "/tmp/repo-b", "repo-b"),
    ];
    const selectedLogicalWorkspaceId = "worktree-6";
    const selectedWorkspaceId = logicalWorkspaces[6]!.localWorkspace!.id;
    mocks.logicalWorkspaces = logicalWorkspaces;
    useSessionSelectionStore.setState({
      selectedWorkspaceId,
      workspaceSelectionNonce: 1,
    });

    const rendered = renderRepoGroupState({
      logicalWorkspaces,
      selectedLogicalWorkspaceId,
      selectedWorkspaceId,
    });
    await waitFor(() => {
      expect(useWorkspaceSidebarShowMoreStore.getState().repoGroupsShownMore).toEqual([
        "/tmp/repo-a",
      ]);
    });

    act(() => {
      rendered.result.current.handleToggleAllRepoGroups();
    });
    expect(useWorkspaceSidebarShowMoreStore.getState().repoGroupsShownMore).toEqual([]);
    await flushEffects();
    expect(useWorkspaceSidebarShowMoreStore.getState().repoGroupsShownMore).toEqual([]);

    act(() => {
      rendered.result.current.handleToggleAllRepoGroups();
    });

    await waitFor(() => {
      expect(useWorkspaceSidebarShowMoreStore.getState().repoGroupsShownMore).toEqual([
        "/tmp/repo-a",
      ]);
    });
  });

  it("preserves manual Show more while the repo key still exists", async () => {
    const logicalWorkspaces = makeRepoWorkspaces(7);
    mocks.logicalWorkspaces = logicalWorkspaces;
    const rendered = renderRepoGroupState({
      logicalWorkspaces,
      selectedLogicalWorkspaceId: null,
      selectedWorkspaceId: null,
    });

    act(() => {
      rendered.result.current.handleToggleRepoShowMore("/tmp/repo-a");
    });
    rendered.rerender({
      groups: buildGroups({
        logicalWorkspaces: logicalWorkspaces.slice(0, 5),
      }),
      selectedLogicalWorkspaceId: null,
      selectedWorkspaceId: null,
    });
    await flushEffects();

    expect(useWorkspaceSidebarShowMoreStore.getState().repoGroupsShownMore).toEqual([
      "/tmp/repo-a",
    ]);
  });

  it("clears shown-more state and auto record only when the repo key disappears", async () => {
    const logicalWorkspaces = makeRepoWorkspaces(7);
    const selectedLogicalWorkspaceId = "worktree-6";
    const selectedWorkspaceId = logicalWorkspaces[6]!.localWorkspace!.id;
    mocks.logicalWorkspaces = logicalWorkspaces;
    useWorkspaceSidebarShowMoreStore.setState({
      repoGroupsShownMore: ["/tmp/repo-a", "/tmp/repo-missing"],
      repoGroupsShowMoreClearedByCollapse: ["/tmp/repo-missing"],
      lastAutoShownMoreSelection: {
        logicalWorkspaceId: selectedLogicalWorkspaceId,
        selectedWorkspaceId,
        repoKey: "/tmp/repo-missing",
        workspaceSelectionNonce: 1,
      },
    });

    const rendered = renderRepoGroupState({
      logicalWorkspaces,
      selectedLogicalWorkspaceId,
      selectedWorkspaceId,
    });
    await waitFor(() => {
      expect(useWorkspaceSidebarShowMoreStore.getState().repoGroupsShownMore).toEqual([
        "/tmp/repo-a",
      ]);
      expect(useWorkspaceSidebarShowMoreStore.getState().repoGroupsShowMoreClearedByCollapse)
        .toEqual([]);
      expect(useWorkspaceSidebarShowMoreStore.getState().lastAutoShownMoreSelection).toBeNull();
    });

    act(() => {
      rendered.result.current.handleToggleRepoCollapsed("/tmp/repo-a");
    });
    expect(useWorkspaceSidebarShowMoreStore.getState().repoGroupsShownMore).toEqual([]);
    expect(useWorkspaceSidebarShowMoreStore.getState().lastAutoShownMoreSelection).toBeNull();
  });

  it("clears shown-more state when collapsing all repo groups", () => {
    const logicalWorkspaces = [
      ...makeRepoWorkspaces(7, "/tmp/repo-a", "repo-a"),
      ...makeRepoWorkspaces(7, "/tmp/repo-b", "repo-b"),
    ];
    mocks.logicalWorkspaces = logicalWorkspaces;
    useWorkspaceSidebarShowMoreStore.setState({
      repoGroupsShownMore: ["/tmp/repo-a", "/tmp/repo-b"],
    });

    const rendered = renderRepoGroupState({
      logicalWorkspaces,
      selectedLogicalWorkspaceId: null,
      selectedWorkspaceId: null,
    });

    act(() => {
      rendered.result.current.handleToggleAllRepoGroups();
    });

    expect([...useWorkspaceUiStore.getState().collapsedRepoGroups].sort()).toEqual([
      "/tmp/repo-a",
      "/tmp/repo-b",
    ]);
    expect(useWorkspaceSidebarShowMoreStore.getState().repoGroupsShownMore).toEqual([]);
  });
});

function renderRepoGroupState(args: {
  logicalWorkspaces: LogicalWorkspace[];
  selectedLogicalWorkspaceId: string | null;
  selectedWorkspaceId: string | null;
}) {
  return renderHook(
    (props: {
      groups: ReturnType<typeof buildGroups>;
      selectedLogicalWorkspaceId: string | null;
      selectedWorkspaceId: string | null;
    }) => useSidebarRepoGroupState(props),
    {
      initialProps: {
        groups: buildGroups({
          logicalWorkspaces: args.logicalWorkspaces,
          selectedLogicalWorkspaceId: args.selectedLogicalWorkspaceId,
        }),
        selectedLogicalWorkspaceId: args.selectedLogicalWorkspaceId,
        selectedWorkspaceId: args.selectedWorkspaceId,
      },
    },
  );
}

function makeRepoWorkspaces(
  count: number,
  repoKey = "/tmp/repo-a",
  repoName = "repo-a",
): LogicalWorkspace[] {
  return Array.from({ length: count }, (_, index) =>
    makeLocalLogicalWorkspace({
      id: repoName === "repo-a" ? `worktree-${index}` : `${repoName}-worktree-${index}`,
      repoKey,
      repoName,
      kind: "worktree",
      branch: `feature/worktree-${index}`,
      updatedAt: `2026-04-13T10:0${index}:00.000Z`,
    }));
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
  });
}
