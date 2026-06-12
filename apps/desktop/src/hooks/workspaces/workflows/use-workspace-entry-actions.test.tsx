// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Workspace } from "@anyharness/sdk";
import { useWorkspaceEntryActions } from "./use-workspace-entry-actions";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import { useSessionTranscriptStore } from "@/stores/sessions/session-transcript-store";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";
import { chatWorkspaceShellTabKey } from "@/lib/domain/workspaces/tabs/shell-tabs";
import { buildPendingWorkspaceUiKey } from "@/lib/domain/workspaces/creation/pending-entry";

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

vi.mock("@/hooks/workspaces/cache/use-workspaces", () => ({
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
        cleanupState: "none",
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
  const actual = await importOriginal<typeof import("./use-workspace-entry-flow")>();
  return {
    useWorkspaceEntryFlow: () => ({
      ...actual.useWorkspaceEntryFlow(),
      selectWorkspaceWithArrival: mocks.selectWorkspaceWithArrival,
    }),
  };
});

vi.mock("@/hooks/chat/derived/use-active-session-config-state", () => ({
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

vi.mock("@/stores/editor/workspace-editor-state", () => ({
  resetWorkspaceEditorState: mocks.resetWorkspaceEditorState,
}));

vi.mock("@/stores/chat/chat-input-store", () => ({
  useChatInputStore: {
    getState: () => ({
      requestFocus: mocks.requestFocus,
    }),
  },
}));

vi.mock("@/hooks/workspaces/workflows/use-pending-workspace-session-materialization", () => ({
  usePendingWorkspaceSessionMaterialization: () => mocks.materializePendingWorkspaceSessions,
}));

vi.mock("@/hooks/chat/derived/use-configured-launch-readiness", () => ({
  useConfiguredLaunchReadiness: () => ({
    selection: null,
    displayName: null,
  }),
}));

vi.mock("@/lib/infra/measurement/debug-latency", () => ({
  elapsedMs: () => 0,
  elapsedSince: () => 0,
  logLatency: vi.fn(),
  startLatencyTimer: () => 0,
}));

vi.mock("@/lib/infra/measurement/latency-flow", () => ({
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
      defaultSessionModeByAgentKind: {},
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
    const pendingEntry = useSessionSelectionStore.getState().pendingWorkspaceEntry;
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
        pendingEntryAtInteraction = useSessionSelectionStore.getState().pendingWorkspaceEntry;
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
    expect(useSessionSelectionStore.getState().pendingWorkspaceEntry).toBeNull();
    expect(useWorkspaceUiStore.getState().workspaceLastInteracted["workspace-created"])
      .toEqual(expect.any(String));
    expect(pendingEntryAtInteraction).toMatchObject({
      source: "worktree-created",
      workspaceId: "workspace-created",
    });
  });

  it("seeds a projected pending session from saved defaults when no initial session is passed", async () => {
    useUserPreferencesStore.setState({
      defaultChatAgentKind: "claude",
      defaultChatModelIdByAgentKind: {
        claude: "us.anthropic.claude-sonnet-4-6",
      },
      defaultSessionModeByAgentKind: {
        claude: "default",
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
    const pendingEntry = useSessionSelectionStore.getState().pendingWorkspaceEntry;
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
    cleanupState: "none",
    cleanupOperation: null,
    cleanupErrorMessage: null,
    cleanupFailedAt: null,
    cleanupAttemptedAt: null,
    executionSummary: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  } as Workspace;
}
