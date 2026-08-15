import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildPendingWorkspaceUiKey,
  buildSubmittingPendingWorkspaceEntry,
} from "#product/lib/domain/workspaces/creation/pending-entry";
import { useWorkspaceUiStore } from "#product/stores/preferences/workspace-ui-store";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { useSessionTranscriptStore } from "#product/stores/sessions/session-transcript-store";
import {
  EMPTY_PENDING_WORKSPACE_REGISTRY,
  type PendingWorkspaceRegistry,
  upsertPendingWorkspaceEntry,
} from "#product/lib/domain/workspaces/creation/pending-entry-registry";

const mocks = vi.hoisted(() => ({
  selectWorkspace: vi.fn(),
  enterPendingWorkspaceShell: vi.fn(),
  setPendingWorkspaceEntry: vi.fn(),
  setWorkspaceArrivalEvent: vi.fn(),
  resetWorkspaceFiles: vi.fn(),
  requestChatInputFocus: vi.fn(),
  materializePendingWorkspaceSessions: vi.fn(),
  clearPendingWorkspaceEntry: vi.fn(),
    harnessState: {
      pendingWorkspaces: {
        entriesByAttemptId: {},
        attemptOrder: [],
      } as PendingWorkspaceRegistry,
      selectedLogicalWorkspaceId: null as string | null,
      selectedWorkspaceId: null as string | null,
      activeSessionId: null as string | null,
      enterPendingWorkspaceShell: vi.fn(),
      setPendingWorkspaceEntry: vi.fn(),
      clearPendingWorkspaceEntry: vi.fn(),
      setWorkspaceArrivalEvent: vi.fn(),
      bumpSessionActivationIntentEpoch: vi.fn(() => 1),
    },
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useCallback: <T extends (...args: never[]) => unknown>(callback: T) => callback,
  };
});

vi.mock("#product/hooks/workspaces/workflows/selection/use-workspace-selection", () => ({
  useWorkspaceSelection: () => ({
    selectWorkspace: mocks.selectWorkspace,
  }),
}));

vi.mock("#product/stores/editor/workspace-editor-state", () => ({
  resetWorkspaceEditorState: mocks.resetWorkspaceFiles,
}));

vi.mock("#product/stores/chat/chat-input-store", () => ({
  useChatInputStore: {
    getState: () => ({
      requestFocus: mocks.requestChatInputFocus,
    }),
  },
}));

vi.mock("#product/stores/sessions/session-selection-store", () => {
  const useSessionSelectionStore = Object.assign(
    (selector: (state: typeof mocks.harnessState) => unknown) =>
      selector(mocks.harnessState),
    {
      getState: () => mocks.harnessState,
    },
  );
  return { useSessionSelectionStore };
});

vi.mock("#product/hooks/workspaces/workflows/use-pending-workspace-session-materialization", () => ({
  usePendingWorkspaceSessionMaterialization: () => mocks.materializePendingWorkspaceSessions,
}));

vi.mock("#product/hooks/chat/derived/use-configured-launch-readiness", () => ({
  useConfiguredLaunchReadiness: () => ({
    selection: null,
    displayName: null,
  }),
}));

vi.mock("#product/hooks/chat/derived/use-active-session-config-state", () => ({
  useActiveSessionLaunchState: () => ({
    currentLaunchIdentity: null,
  }),
  useActiveSessionModeState: () => ({
    currentModeId: null,
  }),
}));

vi.mock("#product/lib/infra/measurement/measurement-port", () => ({
  elapsedSince: () => 0,
  logLatency: vi.fn(),
}));

describe("useWorkspaceEntryFlow", () => {
  beforeEach(() => {
    mocks.selectWorkspace.mockReset();
    mocks.enterPendingWorkspaceShell.mockReset();
    mocks.setPendingWorkspaceEntry.mockReset();
    mocks.setWorkspaceArrivalEvent.mockReset();
    mocks.resetWorkspaceFiles.mockReset();
    mocks.requestChatInputFocus.mockReset();
    mocks.materializePendingWorkspaceSessions.mockReset();
    mocks.clearPendingWorkspaceEntry.mockReset();
    mocks.harnessState.pendingWorkspaces = EMPTY_PENDING_WORKSPACE_REGISTRY;
    mocks.harnessState.selectedLogicalWorkspaceId = null;
    mocks.harnessState.selectedWorkspaceId = null;
    mocks.harnessState.activeSessionId = null;
    mocks.harnessState.enterPendingWorkspaceShell = mocks.enterPendingWorkspaceShell;
    mocks.harnessState.setPendingWorkspaceEntry = mocks.setPendingWorkspaceEntry;
    mocks.harnessState.clearPendingWorkspaceEntry = mocks.clearPendingWorkspaceEntry;
    mocks.harnessState.setWorkspaceArrivalEvent = mocks.setWorkspaceArrivalEvent;
    mocks.harnessState.bumpSessionActivationIntentEpoch.mockReset();
    mocks.harnessState.bumpSessionActivationIntentEpoch.mockReturnValue(1);
    useSessionDirectoryStore.getState().clearEntries();
    useSessionTranscriptStore.getState().clearEntries();
    useWorkspaceUiStore.setState({
      _hydrated: false,
      collapsedRepoGroups: [],
    });
  });

  it("expands the requested repo folder before selecting with arrival", async () => {
    const { useWorkspaceEntryFlow } = await import("#product/hooks/workspaces/workflows/use-workspace-entry-flow");
    const repoGroupKey = "/Users/pablo/proliferate";
    useWorkspaceUiStore.setState({
      collapsedRepoGroups: [repoGroupKey, "/tmp/other-repo"],
    });

    const flow = useWorkspaceEntryFlow();
    await flow.selectWorkspaceWithArrival({
      workspaceId: "workspace-1",
      source: "local-created",
      repoGroupKeyToExpand: repoGroupKey,
    });

    expect(useWorkspaceUiStore.getState().collapsedRepoGroups).toEqual([
      "/tmp/other-repo",
    ]);
    expect(mocks.setWorkspaceArrivalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "workspace-1",
        source: "local-created",
      }),
    );
    expect(mocks.selectWorkspace).toHaveBeenCalledWith("workspace-1", {
      force: true,
    });
    expect(mocks.requestChatInputFocus).toHaveBeenCalledTimes(1);
  });

  it("requests composer focus when opening the pending workspace shell", async () => {
    const { useWorkspaceEntryFlow } = await import("#product/hooks/workspaces/workflows/use-workspace-entry-flow");
    const entry = buildSubmittingPendingWorkspaceEntry({
      attemptId: "attempt-1",
      selectedWorkspaceId: null,
      source: "local-created",
      displayName: "proliferate",
      request: { kind: "local", sourceRoot: "/Users/pablo/proliferate" },
    });

    const flow = useWorkspaceEntryFlow();
    flow.beginPendingWorkspace(entry);

    expect(mocks.resetWorkspaceFiles).toHaveBeenCalledTimes(1);
    expect(mocks.enterPendingWorkspaceShell).toHaveBeenCalledWith(entry, {
      initialActiveSessionId: null,
    });
    expect(mocks.requestChatInputFocus).toHaveBeenCalledTimes(1);
  });

  it("opens a projected session shell when the pending workspace has an initial session", async () => {
    const { useWorkspaceEntryFlow } = await import("#product/hooks/workspaces/workflows/use-workspace-entry-flow");
    const entry = buildSubmittingPendingWorkspaceEntry({
      attemptId: "attempt-1",
      selectedWorkspaceId: null,
      source: "local-created",
      displayName: "proliferate",
      request: { kind: "local", sourceRoot: "/Users/pablo/proliferate" },
    });

    const flow = useWorkspaceEntryFlow();
    const projectedSessionId = flow.beginPendingWorkspace(entry, {
      initialSession: {
        kind: "session",
        agentKind: "codex",
        modelId: "gpt-5.5",
        modeId: "xhigh",
        displayTitle: "gpt-5.5",
      },
    });

    expect(projectedSessionId).toEqual(expect.stringContaining("client-session:codex:"));
    expect(mocks.enterPendingWorkspaceShell).toHaveBeenCalledWith(entry, {
      initialActiveSessionId: projectedSessionId,
    });
  });

  it("materializes projected sessions before clearing finalized pending workspace", async () => {
    const { useWorkspaceEntryFlow } = await import("#product/hooks/workspaces/workflows/use-workspace-entry-flow");
    const entry = buildSubmittingPendingWorkspaceEntry({
      attemptId: "attempt-1",
      selectedWorkspaceId: null,
      source: "cloud-created",
      displayName: "feature-branch",
      request: {
        kind: "select-existing",
        workspaceId: "cloud-workspace-1",
      },
    });
    mocks.harnessState.pendingWorkspaces = upsertPendingWorkspaceEntry(
      EMPTY_PENDING_WORKSPACE_REGISTRY,
      entry,
    );
    mocks.harnessState.selectedLogicalWorkspaceId = buildPendingWorkspaceUiKey(entry);

    const flow = useWorkspaceEntryFlow();
    await expect(flow.finalizeSelection(entry, "cloud-workspace-1")).resolves.toEqual({
      committed: true,
      selected: true,
    });

    // Attendance is decided once, before the force-selection, and handed to
    // materialization rather than re-read after the await (PRO-230).
    expect(mocks.materializePendingWorkspaceSessions).toHaveBeenCalledWith(
      entry,
      "cloud-workspace-1",
      { attended: true },
    );
    expect(mocks.setPendingWorkspaceEntry).toHaveBeenCalledWith(expect.objectContaining({
      attemptId: "attempt-1",
      workspaceId: "cloud-workspace-1",
      errorMessage: null,
    }));
    expect(mocks.clearPendingWorkspaceEntry).toHaveBeenCalledWith("attempt-1");
    expect(mocks.setWorkspaceArrivalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "cloud-workspace-1",
        source: "cloud-created",
      }),
    );
  });

  it("finishes an unattended attempt without stealing the current selection", async () => {
    const { useWorkspaceEntryFlow } = await import("#product/hooks/workspaces/workflows/use-workspace-entry-flow");
    const entry = buildSubmittingPendingWorkspaceEntry({
      attemptId: "attempt-1",
      selectedWorkspaceId: null,
      source: "worktree-created",
      displayName: "feature-branch",
      request: {
        kind: "select-existing",
        workspaceId: "workspace-new",
      },
    });
    mocks.harnessState.pendingWorkspaces = upsertPendingWorkspaceEntry(
      EMPTY_PENDING_WORKSPACE_REGISTRY,
      entry,
    );
    // The user switched away mid-launch: another workspace is selected.
    mocks.harnessState.selectedWorkspaceId = "workspace-other";
    mocks.harnessState.selectedLogicalWorkspaceId = "workspace-other";

    const flow = useWorkspaceEntryFlow();
    await expect(flow.finalizeSelection(entry, "workspace-new")).resolves.toEqual({
      committed: true,
      selected: false,
    });

    expect(mocks.materializePendingWorkspaceSessions).toHaveBeenCalledWith(
      entry,
      "workspace-new",
      { attended: false },
    );
    expect(mocks.clearPendingWorkspaceEntry).toHaveBeenCalledWith("attempt-1");
    expect(mocks.selectWorkspace).not.toHaveBeenCalled();
    expect(mocks.setWorkspaceArrivalEvent).not.toHaveBeenCalled();
  });
});
