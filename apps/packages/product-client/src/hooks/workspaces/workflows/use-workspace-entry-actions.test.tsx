// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Workspace } from "@anyharness/sdk";
import { useWorkspaceEntryActions } from "#product/hooks/workspaces/workflows/use-workspace-entry-actions";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { useSessionTranscriptStore } from "#product/stores/sessions/session-transcript-store";
import { useWorkspaceUiStore } from "#product/stores/preferences/workspace-ui-store";
import { useUserPreferencesStore } from "#product/stores/preferences/user-preferences-store";
import { chatWorkspaceShellTabKey } from "#product/lib/domain/workspaces/tabs/shell-tabs";
import { buildPendingWorkspaceUiKey } from "#product/lib/domain/workspaces/creation/pending-entry";
import {
  pendingWorkspaceEntries,
} from "#product/lib/domain/workspaces/creation/pending-entry-registry";

const mocks = vi.hoisted(() => ({
  resolveWorktreeCreationInput: vi.fn(),
  createWorktreeWorkspace: vi.fn(),
  createLocalWorkspace: vi.fn(),
  selectWorkspace: vi.fn(async () => undefined),
  selectWorkspaceWithArrival: vi.fn(async () => undefined),
  requestFocus: vi.fn(),
  resetWorkspaceEditorState: vi.fn(),
  materializePendingWorkspaceSessions: vi.fn(),
}));

vi.mock("#product/hooks/workspaces/cache/use-workspaces", () => ({
  useWorkspaces: () => ({
    data: {
      repoRoots: [{
        id: "repo-root-1",
        path: "/Users/pablo/proliferate",
        remoteRepoName: "proliferate",
        defaultBranch: "main",
      }],
      localWorkspaces: [{
        id: "workspace-source",
        kind: "local",
        repoRootId: "repo-root-1",
        path: "/Users/pablo/proliferate",
        surface: "standard",
        currentBranch: "main",
        originalBranch: "main",
        lifecycleState: "active",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }],
    },
  }),
}));

vi.mock("./use-workspace-actions", () => ({
  useWorkspaceActions: () => ({
    resolveWorktreeCreationInput: mocks.resolveWorktreeCreationInput,
    createLocalWorkspace: mocks.createLocalWorkspace,
    isCreatingLocalWorkspace: false,
    createWorktreeWorkspace: mocks.createWorktreeWorkspace,
    isCreatingWorktreeWorkspace: false,
  }),
}));

vi.mock("./use-workspace-entry-flow", async (importOriginal) => {
  const actual = await importOriginal<typeof import("#product/hooks/workspaces/workflows/use-workspace-entry-flow")>();
  return {
    useWorkspaceEntryFlow: () => ({
      ...actual.useWorkspaceEntryFlow(),
      selectWorkspaceWithArrival: mocks.selectWorkspaceWithArrival,
    }),
  };
});

vi.mock("#product/hooks/chat/derived/use-active-session-config-state", () => ({
  useActiveSessionLaunchState: () => ({
    currentLaunchIdentity: null,
  }),
  useActiveSessionModeState: () => ({
    currentModeId: null,
  }),
}));

vi.mock("./selection/use-workspace-selection", () => ({
  useWorkspaceSelection: () => ({
    selectWorkspace: mocks.selectWorkspace,
  }),
}));

vi.mock("#product/stores/editor/workspace-editor-state", () => ({
  resetWorkspaceEditorState: mocks.resetWorkspaceEditorState,
}));

vi.mock("#product/stores/chat/chat-input-store", () => ({
  useChatInputStore: {
    getState: () => ({
      requestFocus: mocks.requestFocus,
    }),
  },
}));

vi.mock("#product/hooks/workspaces/workflows/use-pending-workspace-session-materialization", () => ({
  usePendingWorkspaceSessionMaterialization: () => mocks.materializePendingWorkspaceSessions,
}));

vi.mock("#product/hooks/chat/derived/use-configured-launch-readiness", () => ({
  useConfiguredLaunchReadiness: () => ({
    selection: null,
    displayName: null,
  }),
}));

vi.mock("#product/lib/infra/measurement/measurement-port", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("#product/lib/infra/measurement/measurement-port")
  >()),
  elapsedMs: () => 0,
  elapsedSince: () => 0,
  logLatency: vi.fn(),
  startLatencyTimer: () => 0,
  annotateLatencyFlow: vi.fn(),
  failLatencyFlow: vi.fn(),
}));

describe("useWorkspaceEntryActions", () => {
  beforeEach(() => {
    mocks.resolveWorktreeCreationInput.mockReset();
    mocks.createWorktreeWorkspace.mockReset();
    mocks.createLocalWorkspace.mockReset();
    mocks.selectWorkspace.mockClear();
    mocks.selectWorkspaceWithArrival.mockClear();
    mocks.requestFocus.mockClear();
    mocks.resetWorkspaceEditorState.mockClear();
    mocks.materializePendingWorkspaceSessions.mockClear();
    useUserPreferencesStore.setState({
      defaultChatAgentKind: "",
      defaultChatModelIdByAgentKind: {},
    });
    useSessionDirectoryStore.getState().clearEntries();
    useSessionTranscriptStore.getState().clearEntries();
    useSessionSelectionStore.getState().clearSelection();
    useWorkspaceUiStore.setState({
      _hydrated: false,
      activeShellTabKeyByWorkspace: {},
      shellTabOrderByWorkspace: {},
      visibleChatSessionIdsByWorkspace: {},
      recentlyHiddenChatSessionIdsByWorkspace: {},
      collapsedChatGroupsByWorkspace: {},
      manualChatGroupsByWorkspace: {},
      workspaceLastInteracted: {},
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("opens the pending worktree shell with resolved path and branch before backend creation finishes", async () => {
    let finishCreate: (value: { workspace: Workspace; setupScript: null }) => void =
      () => {
        throw new Error("create promise resolver was not initialized");
      };
    const createPromise = new Promise<{ workspace: Workspace; setupScript: null }>((resolve) => {
      finishCreate = resolve;
    });
    mocks.resolveWorktreeCreationInput.mockResolvedValueOnce({
      params: {
        repoRootId: "repo-root-1",
        workspaceName: "workspace-abc",
        branchName: "pablo/workspace-abc",
        targetPath: "/Users/pablo/.proliferate/worktrees/proliferate/workspace-abc",
        baseRef: "main",
        setupScript: null,
      },
      source: null,
      repoName: "proliferate",
    });
    mocks.createWorktreeWorkspace.mockReturnValueOnce(createPromise);

    const { result } = renderHook(() => useWorkspaceEntryActions());
    let actionPromise!: Promise<{ workspaceId: string; projectedSessionId: string | null }>;
    await act(async () => {
      actionPromise = result.current.createWorktreeAndEnterWithResult({
        repoRootId: "repo-root-1",
        sourceWorkspaceId: "workspace-source",
        baseBranch: "main",
      }, {
        initialSession: {
          kind: "session",
          agentKind: "codex",
          modelId: "gpt-5.5",
          modeId: "xhigh",
          displayTitle: "gpt-5.5",
        },
      });
    });

    await waitFor(() => expect(mocks.createWorktreeWorkspace).toHaveBeenCalled());
    const pendingEntry = onlyPendingEntry();
    expect(pendingEntry).toMatchObject({
      source: "worktree-created",
      displayName: "workspace-abc",
      repoLabel: "proliferate",
      baseBranchName: "main",
      request: {
        kind: "worktree",
        input: {
          workspaceName: "workspace-abc",
          branchName: "pablo/workspace-abc",
          targetPath: "/Users/pablo/.proliferate/worktrees/proliferate/workspace-abc",
          baseBranch: "main",
        },
      },
    });
    expect(pendingEntry?.request.kind).toBe("worktree");
    if (pendingEntry?.request.kind === "worktree") {
      expect(pendingEntry.request.retryInput).toMatchObject({
        repoRootId: "repo-root-1",
        sourceWorkspaceId: "workspace-source",
        baseBranch: "main",
        generatedName: true,
      });
      expect(pendingEntry.request.retryInput).not.toHaveProperty("branchName");
      expect(pendingEntry.request.retryInput).not.toHaveProperty("targetPath");
    }
    expect(useSessionSelectionStore.getState().activeSessionId).toEqual(
      expect.stringContaining("client-session:codex:"),
    );
    const projectedSessionId = useSessionSelectionStore.getState().activeSessionId;
    const pendingWorkspaceUiKey = buildPendingWorkspaceUiKey(pendingEntry!);
    expect(useSessionDirectoryStore.getState().sessionIdsByWorkspaceId[pendingWorkspaceUiKey])
      .toContain(projectedSessionId);
    expect(
      useWorkspaceUiStore.getState().activeShellTabKeyByWorkspace[pendingWorkspaceUiKey],
    ).toBe(chatWorkspaceShellTabKey(projectedSessionId!));

    let pendingEntryAtInteraction: unknown = null;
    const unsubscribe = useWorkspaceUiStore.subscribe((state, previousState) => {
      if (
        state.workspaceLastInteracted["workspace-created"]
        && !previousState.workspaceLastInteracted["workspace-created"]
      ) {
        pendingEntryAtInteraction = onlyPendingEntry();
      }
    });

    finishCreate({
      workspace: worktreeWorkspace("workspace-created"),
      setupScript: null,
    });
    await expect(actionPromise).resolves.toMatchObject({
      workspaceId: "workspace-created",
    });
    unsubscribe();
    expect(onlyPendingEntry()).toBeNull();
    expect(useSessionSelectionStore.getState().workspaceArrivalEvent).toMatchObject({
      workspaceId: "workspace-created",
      source: "worktree-created",
      receiptClientSessionId: projectedSessionId,
    });
    expect(useWorkspaceUiStore.getState().workspaceLastInteracted["workspace-created"])
      .toEqual(expect.any(String));
    expect(pendingEntryAtInteraction).toMatchObject({
      source: "worktree-created",
      workspaceId: "workspace-created",
    });
  });

  it("completes a worktree launch after the user switches away mid-flight", async () => {
    let finishCreate: (value: { workspace: Workspace; setupScript: null }) => void =
      () => {
        throw new Error("create promise resolver was not initialized");
      };
    const createPromise = new Promise<{ workspace: Workspace; setupScript: null }>((resolve) => {
      finishCreate = resolve;
    });
    mocks.resolveWorktreeCreationInput.mockResolvedValueOnce({
      params: {
        repoRootId: "repo-root-1",
        workspaceName: "workspace-abc",
        branchName: "pablo/workspace-abc",
        targetPath: "/Users/pablo/.proliferate/worktrees/proliferate/workspace-abc",
        baseRef: "main",
        setupScript: null,
      },
      source: null,
      repoName: "proliferate",
    });
    mocks.createWorktreeWorkspace.mockReturnValueOnce(createPromise);

    const { result } = renderHook(() => useWorkspaceEntryActions());
    let actionPromise!: Promise<{ workspaceId: string; projectedSessionId: string | null } | null>;
    await act(async () => {
      actionPromise = result.current.createWorktreeAndEnterWithResult({
        repoRootId: "repo-root-1",
        sourceWorkspaceId: "workspace-source",
        baseBranch: "main",
      }, {
        initialSession: {
          kind: "session",
          agentKind: "codex",
          modelId: "gpt-5.5",
          modeId: "xhigh",
          displayTitle: "gpt-5.5",
        },
      });
    });
    await waitFor(() => expect(mocks.createWorktreeWorkspace).toHaveBeenCalled());
    const pendingEntry = onlyPendingEntry();

    // The user leaves the pending shell while the backend create is still open.
    act(() => {
      useSessionSelectionStore.getState().activateWorkspace({
        logicalWorkspaceId: "workspace-other",
        workspaceId: "workspace-other",
        initialActiveSessionId: "session-other",
      });
    });
    expect(onlyPendingEntry()).toMatchObject({ attemptId: pendingEntry?.attemptId });

    finishCreate({
      workspace: worktreeWorkspace("workspace-created"),
      setupScript: null,
    });

    // The launch runs to completion in the background...
    await expect(actionPromise).resolves.toMatchObject({
      workspaceId: "workspace-created",
    });
    expect(mocks.materializePendingWorkspaceSessions).toHaveBeenCalledWith(
      expect.objectContaining({ attemptId: pendingEntry?.attemptId }),
      "workspace-created",
      // The user moved away before finalization, and that one decision governs
      // materialization too (PRO-230).
      { attended: false },
    );
    expect(onlyPendingEntry()).toBeNull();
    // ...without pulling the user back out of the workspace they moved to.
    expect(useSessionSelectionStore.getState().selectedWorkspaceId).toBe("workspace-other");
    expect(useSessionSelectionStore.getState().activeSessionId).toBe("session-other");
    expect(useSessionSelectionStore.getState().workspaceArrivalEvent).toBeNull();
  });

  it("seeds a projected pending session from saved defaults when no initial session is passed", async () => {
    useUserPreferencesStore.setState({
      defaultChatAgentKind: "claude",
      defaultChatModelIdByAgentKind: {
        claude: "us.anthropic.claude-sonnet-4-6",
      },
    });
    let finishCreate: (value: { workspace: Workspace; setupScript: null }) => void =
      () => {
        throw new Error("create promise resolver was not initialized");
      };
    const createPromise = new Promise<{ workspace: Workspace; setupScript: null }>((resolve) => {
      finishCreate = resolve;
    });
    mocks.resolveWorktreeCreationInput.mockResolvedValueOnce({
      params: {
        repoRootId: "repo-root-1",
        workspaceName: "workspace-abc",
        branchName: "pablo/workspace-abc",
        targetPath: "/Users/pablo/.proliferate/worktrees/proliferate/workspace-abc",
        baseRef: "main",
        setupScript: null,
      },
      source: null,
      repoName: "proliferate",
    });
    mocks.createWorktreeWorkspace.mockReturnValueOnce(createPromise);

    const { result } = renderHook(() => useWorkspaceEntryActions());
    let actionPromise!: Promise<{ workspaceId: string; projectedSessionId: string | null }>;
    await act(async () => {
      actionPromise = result.current.createWorktreeAndEnterWithResult({
        repoRootId: "repo-root-1",
        sourceWorkspaceId: "workspace-source",
        baseBranch: "main",
      });
    });

    await waitFor(() => expect(mocks.createWorktreeWorkspace).toHaveBeenCalled());
    const pendingEntry = onlyPendingEntry();
    expect(pendingEntry).not.toBeNull();
    const projectedSessionId = useSessionSelectionStore.getState().activeSessionId;
    expect(projectedSessionId).toEqual(expect.stringContaining("client-session:claude:"));
    const pendingWorkspaceUiKey = buildPendingWorkspaceUiKey(pendingEntry!);
    expect(useSessionDirectoryStore.getState().sessionIdsByWorkspaceId[pendingWorkspaceUiKey])
      .toContain(projectedSessionId);
    expect(useSessionDirectoryStore.getState().entriesById[projectedSessionId!]).toMatchObject({
      workspaceId: pendingWorkspaceUiKey,
      agentKind: "claude",
      modelId: "us.anthropic.claude-sonnet-4-6",
      modeId: "default",
      title: "Sonnet 4.6",
      materializedSessionId: null,
    });
    expect(
      useWorkspaceUiStore.getState().activeShellTabKeyByWorkspace[pendingWorkspaceUiKey],
    ).toBe(chatWorkspaceShellTabKey(projectedSessionId!));

    finishCreate({
      workspace: worktreeWorkspace("workspace-created"),
      setupScript: null,
    });
    await expect(actionPromise).resolves.toMatchObject({
      workspaceId: "workspace-created",
      projectedSessionId,
    });
  });
});

/** This slice keeps at most one attempt in flight per test. */
function onlyPendingEntry() {
  return pendingWorkspaceEntries(useSessionSelectionStore.getState().pendingWorkspaces)[0] ?? null;
}

function worktreeWorkspace(id: string): Workspace {
  return {
    id,
    kind: "worktree",
    repoRootId: "repo-root-1",
    path: "/Users/pablo/.proliferate/worktrees/proliferate/workspace-abc",
    surface: "standard",
    originalBranch: "main",
    currentBranch: "pablo/workspace-abc",
    displayName: "workspace-abc",
    origin: null,
    creatorContext: null,
    lifecycleState: "active",
    executionSummary: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  } as Workspace;
}
