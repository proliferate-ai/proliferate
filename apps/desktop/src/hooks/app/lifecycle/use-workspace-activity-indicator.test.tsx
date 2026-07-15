// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetWorkspaceActivityIndicatorExportForTests,
  useWorkspaceActivityIndicator,
} from "@/hooks/app/lifecycle/use-workspace-activity-indicator";
import { createDirectoryEntry } from "@/lib/domain/sessions/directory/directory-entry";
import {
  makeLocalLogicalWorkspace,
} from "@/lib/domain/workspaces/sidebar/sidebar-test-fixtures";

const tauriMocks = vi.hoisted(() => ({
  setWorkspaceActivityIndicator: vi.fn(async () => undefined),
}));

const harnessState = vi.hoisted(() => ({
  logicalWorkspaces: [] as unknown[],
  logicalWorkspacesLoading: false,
  workspaceActivities: {} as Record<string, string>,
  workspaceUi: {
    _hydrated: true,
    archivedWorkspaceIds: [] as string[],
    hiddenRepoRootIds: [] as string[],
    lastViewedAt: {} as Record<string, string>,
    lastViewedSessionErrorAtBySession: {} as Record<string, string>,
    sessionLastInteracted: {} as Record<string, string>,
    sessionLastViewedAt: {} as Record<string, string>,
    workspaceLastInteracted: {} as Record<string, string>,
    workspaceTypes: ["local", "worktree", "cloud", "ssh"],
  },
  deferredHome: {
    launches: {} as Record<string, { workspaceId: string }>,
  },
  sessionSelection: {
    _hydrated: true,
    selectedLogicalWorkspaceId: null as string | null,
  },
  sessionDirectory: {
    entriesById: {} as Record<string, ReturnType<typeof createDirectoryEntry>>,
  },
}));

vi.mock("@/hooks/workspaces/derived/use-logical-workspaces", () => ({
  useLogicalWorkspaces: () => ({
    logicalWorkspaces: harnessState.logicalWorkspaces,
    isLoading: harnessState.logicalWorkspacesLoading,
  }),
}));

vi.mock("@/hooks/workspaces/derived/use-workspace-sidebar-activities", () => ({
  useWorkspaceSidebarActivityStatesWithErrorAttention: () =>
    harnessState.workspaceActivities,
}));

vi.mock("@/stores/preferences/workspace-ui-store", () => ({
  useWorkspaceUiStore: (selector: (state: typeof harnessState.workspaceUi) => unknown) =>
    selector(harnessState.workspaceUi),
}));

vi.mock("@/stores/sessions/session-selection-store", () => ({
  useSessionSelectionStore: (
    selector: (state: typeof harnessState.sessionSelection) => unknown,
  ) => selector(harnessState.sessionSelection),
}));

vi.mock("@/stores/sessions/session-directory-store", () => ({
  useSessionDirectoryStore: (
    selector: (state: typeof harnessState.sessionDirectory) => unknown,
  ) => selector(harnessState.sessionDirectory),
}));

vi.mock("@/stores/home/deferred-home-launch-store", () => ({
  useDeferredHomeLaunchStore: (
    selector: (state: typeof harnessState.deferredHome) => unknown,
  ) => selector(harnessState.deferredHome),
}));

describe("useWorkspaceActivityIndicator", () => {
  beforeEach(() => {
    harnessState.logicalWorkspaces = [];
    harnessState.logicalWorkspacesLoading = false;
    harnessState.workspaceActivities = {};
    harnessState.workspaceUi = {
      _hydrated: true,
      archivedWorkspaceIds: [],
      hiddenRepoRootIds: [],
      lastViewedAt: {},
      lastViewedSessionErrorAtBySession: {},
      sessionLastInteracted: {},
      sessionLastViewedAt: {},
      workspaceLastInteracted: {},
      workspaceTypes: ["local", "worktree", "cloud", "ssh"],
    };
    harnessState.deferredHome = {
      launches: {},
    };
    harnessState.sessionSelection = {
      _hydrated: true,
      selectedLogicalWorkspaceId: null,
    };
    harnessState.sessionDirectory = {
      entriesById: {},
    };
    tauriMocks.setWorkspaceActivityIndicator.mockReset();
    tauriMocks.setWorkspaceActivityIndicator.mockResolvedValue(undefined);
    resetWorkspaceActivityIndicatorExportForTests();
  });

  afterEach(() => {
    cleanup();
  });

  it("exports native state only when the aggregate payload changes", async () => {
    harnessState.logicalWorkspaces = [
      makeLocalLogicalWorkspace({
        id: "review-workspace",
        repoKey: "/tmp/repo-a",
        repoName: "repo-a",
      }),
    ];
    harnessState.workspaceUi.workspaceLastInteracted = {
      "review-workspace-materialization": "2026-04-13T10:00:00.000Z",
    };
    harnessState.workspaceUi.lastViewedAt = {
      "review-workspace": "2026-04-13T10:05:00.000Z",
    };

    const { rerender } = renderHook(() => useWorkspaceActivityIndicator(tauriMocks.setWorkspaceActivityIndicator));

    await waitFor(() => {
      expect(tauriMocks.setWorkspaceActivityIndicator).toHaveBeenCalledTimes(1);
    });
    expect(tauriMocks.setWorkspaceActivityIndicator).toHaveBeenLastCalledWith({
      state: "idle",
      attentionCount: 0,
    });

    rerender();
    expect(tauriMocks.setWorkspaceActivityIndicator).toHaveBeenCalledTimes(1);

    harnessState.workspaceUi = {
      ...harnessState.workspaceUi,
      workspaceLastInteracted: {
        "review-workspace-materialization": "2026-04-13T10:10:00.000Z",
      },
      lastViewedAt: {
        "review-workspace": "2026-04-13T10:05:00.000Z",
      },
    };
    rerender();

    await waitFor(() => {
      expect(tauriMocks.setWorkspaceActivityIndicator).toHaveBeenCalledTimes(2);
    });
    expect(tauriMocks.setWorkspaceActivityIndicator).toHaveBeenLastCalledWith({
      state: "attention",
      attentionCount: 1,
    });

    rerender();
    expect(tauriMocks.setWorkspaceActivityIndicator).toHaveBeenCalledTimes(2);
  });

  it("waits for workspace UI hydration before exporting native state", async () => {
    harnessState.workspaceUi = {
      ...harnessState.workspaceUi,
      _hydrated: false,
    };
    harnessState.logicalWorkspaces = [
      makeLocalLogicalWorkspace({
        id: "deferred-workspace",
        repoKey: "/tmp/repo-a",
        repoName: "repo-a",
      }),
    ];
    harnessState.workspaceActivities = {
      "deferred-workspace-materialization": "waiting_input",
    };

    const { rerender } = renderHook(() => useWorkspaceActivityIndicator(tauriMocks.setWorkspaceActivityIndicator));

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(tauriMocks.setWorkspaceActivityIndicator).not.toHaveBeenCalled();

    harnessState.workspaceUi = {
      ...harnessState.workspaceUi,
      _hydrated: true,
    };
    rerender();

    await waitFor(() => {
      expect(tauriMocks.setWorkspaceActivityIndicator).toHaveBeenCalledTimes(1);
    });
    expect(tauriMocks.setWorkspaceActivityIndicator).toHaveBeenLastCalledWith({
      state: "attention",
      attentionCount: 1,
    });
  });

  it("waits for session selection hydration before exporting native state", async () => {
    harnessState.sessionSelection = {
      ...harnessState.sessionSelection,
      _hydrated: false,
    };
    harnessState.logicalWorkspaces = [
      makeLocalLogicalWorkspace({
        id: "selected-filtered-workspace",
        repoKey: "/tmp/repo-a",
        repoName: "repo-a",
      }),
    ];
    harnessState.workspaceUi.workspaceTypes = ["cloud"];
    harnessState.workspaceActivities = {
      "selected-filtered-workspace-materialization": "waiting_input",
    };

    const { rerender } = renderHook(() => useWorkspaceActivityIndicator(tauriMocks.setWorkspaceActivityIndicator));

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(tauriMocks.setWorkspaceActivityIndicator).not.toHaveBeenCalled();

    harnessState.sessionSelection = {
      _hydrated: true,
      selectedLogicalWorkspaceId: "selected-filtered-workspace",
    };
    rerender();

    await waitFor(() => {
      expect(tauriMocks.setWorkspaceActivityIndicator).toHaveBeenCalledTimes(1);
    });
    expect(tauriMocks.setWorkspaceActivityIndicator).toHaveBeenLastCalledWith({
      state: "attention",
      attentionCount: 1,
    });
  });

  it("waits for logical workspaces to finish loading before exporting native state", async () => {
    harnessState.logicalWorkspacesLoading = true;
    harnessState.logicalWorkspaces = [
      makeLocalLogicalWorkspace({
        id: "loading-workspace",
        repoKey: "/tmp/repo-a",
        repoName: "repo-a",
      }),
    ];
    harnessState.workspaceActivities = {
      "loading-workspace-materialization": "waiting_input",
    };

    const { rerender } = renderHook(() => useWorkspaceActivityIndicator(tauriMocks.setWorkspaceActivityIndicator));

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(tauriMocks.setWorkspaceActivityIndicator).not.toHaveBeenCalled();

    harnessState.logicalWorkspacesLoading = false;
    rerender();

    await waitFor(() => {
      expect(tauriMocks.setWorkspaceActivityIndicator).toHaveBeenCalledTimes(1);
    });
    expect(tauriMocks.setWorkspaceActivityIndicator).toHaveBeenLastCalledWith({
      state: "attention",
      attentionCount: 1,
    });
  });

  it("exports attention for unread session activity", async () => {
    harnessState.logicalWorkspaces = [
      makeLocalLogicalWorkspace({
        id: "session-workspace",
        repoKey: "/tmp/repo-a",
        repoName: "repo-a",
      }),
    ];
    harnessState.sessionDirectory.entriesById = {
      "session-1": createDirectoryEntry({
        sessionId: "session-1",
        workspaceId: "session-workspace-materialization",
        agentKind: "codex",
      }),
    };
    harnessState.workspaceUi.sessionLastInteracted = {
      "session-1": "2026-04-13T10:10:00.000Z",
    };
    harnessState.workspaceUi.sessionLastViewedAt = {
      "session-1": "2026-04-13T10:00:00.000Z",
    };

    renderHook(() => useWorkspaceActivityIndicator(tauriMocks.setWorkspaceActivityIndicator));

    await waitFor(() => {
      expect(tauriMocks.setWorkspaceActivityIndicator).toHaveBeenCalledTimes(1);
    });
    expect(tauriMocks.setWorkspaceActivityIndicator).toHaveBeenLastCalledWith({
      state: "attention",
      attentionCount: 1,
    });
  });

  it("does not cache failed native exports as completed", async () => {
    harnessState.logicalWorkspaces = [
      makeLocalLogicalWorkspace({
        id: "retry-workspace",
        repoKey: "/tmp/repo-a",
        repoName: "repo-a",
      }),
    ];
    harnessState.workspaceActivities = {
      "retry-workspace-materialization": "waiting_input",
    };
    tauriMocks.setWorkspaceActivityIndicator.mockRejectedValueOnce(new Error("native failed"));

    const first = renderHook(() => useWorkspaceActivityIndicator(tauriMocks.setWorkspaceActivityIndicator));

    await waitFor(() => {
      expect(tauriMocks.setWorkspaceActivityIndicator).toHaveBeenCalledTimes(1);
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    first.unmount();

    renderHook(() => useWorkspaceActivityIndicator(tauriMocks.setWorkspaceActivityIndicator));

    await waitFor(() => {
      expect(tauriMocks.setWorkspaceActivityIndicator).toHaveBeenCalledTimes(2);
    });
    expect(tauriMocks.setWorkspaceActivityIndicator).toHaveBeenLastCalledWith({
      state: "attention",
      attentionCount: 1,
    });
  });

  it("does not re-export the same payload after remounting", async () => {
    harnessState.logicalWorkspaces = [
      makeLocalLogicalWorkspace({
        id: "quiet-workspace",
        repoKey: "/tmp/repo-a",
        repoName: "repo-a",
      }),
    ];

    const first = renderHook(() => useWorkspaceActivityIndicator(tauriMocks.setWorkspaceActivityIndicator));

    await waitFor(() => {
      expect(tauriMocks.setWorkspaceActivityIndicator).toHaveBeenCalledTimes(1);
    });
    first.unmount();

    renderHook(() => useWorkspaceActivityIndicator(tauriMocks.setWorkspaceActivityIndicator));

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(tauriMocks.setWorkspaceActivityIndicator).toHaveBeenCalledTimes(1);
  });
});
