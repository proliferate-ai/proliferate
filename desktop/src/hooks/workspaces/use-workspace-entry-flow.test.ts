import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildSubmittingPendingWorkspaceEntry,
  type PendingWorkspaceEntry,
} from "@/lib/domain/workspaces/creation/pending-entry";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import { useSessionTranscriptStore } from "@/stores/sessions/session-transcript-store";

const mocks = vi.hoisted(() => ({
  selectWorkspace: vi.fn(),
  enterPendingWorkspaceShell: vi.fn(),
  setPendingWorkspaceEntry: vi.fn(),
  setWorkspaceArrivalEvent: vi.fn(),
  resetWorkspaceFiles: vi.fn(),
  requestChatInputFocus: vi.fn(),
  materializePendingWorkspaceSessions: vi.fn(),
    harnessState: {
      pendingWorkspaceEntry: null as PendingWorkspaceEntry | null,
      activeSessionId: null as string | null,
      enterPendingWorkspaceShell: vi.fn(),
      setPendingWorkspaceEntry: vi.fn(),
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

vi.mock("@/hooks/workspaces/selection/use-workspace-selection", () => ({
  useWorkspaceSelection: () => ({
    selectWorkspace: mocks.selectWorkspace,
  }),
}));

vi.mock("@/stores/editor/workspace-editor-state", () => ({
  resetWorkspaceEditorState: mocks.resetWorkspaceFiles,
}));

vi.mock("@/stores/chat/chat-input-store", () => ({
  useChatInputStore: {
    getState: () => ({
      requestFocus: mocks.requestChatInputFocus,
    }),
  },
}));

vi.mock("@/stores/sessions/session-selection-store", () => {
  const useSessionSelectionStore = Object.assign(
    (selector: (state: typeof mocks.harnessState) => unknown) =>
      selector(mocks.harnessState),
    {
      getState: () => mocks.harnessState,
    },
  );
  return { useSessionSelectionStore };
});

vi.mock("@/hooks/workspaces/workflows/use-pending-workspace-session-materialization", () => ({
  usePendingWorkspaceSessionMaterialization: () => mocks.materializePendingWorkspaceSessions,
}));

vi.mock("@/hooks/chat/derived/use-configured-launch-readiness", () => ({
  useConfiguredLaunchReadiness: () => ({
    selection: null,
    displayName: null,
  }),
}));

vi.mock("@/hooks/chat/derived/use-active-chat-session-selectors", () => ({
  useActiveSessionLaunchState: () => ({
    currentLaunchIdentity: null,
  }),
  useActiveSessionModeState: () => ({
    currentModeId: null,
  }),
}));

vi.mock("@/lib/infra/measurement/debug-latency", () => ({
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
    mocks.harnessState.pendingWorkspaceEntry = null;
    mocks.harnessState.activeSessionId = null;
    mocks.harnessState.enterPendingWorkspaceShell = mocks.enterPendingWorkspaceShell;
    mocks.harnessState.setPendingWorkspaceEntry = mocks.setPendingWorkspaceEntry;
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
    const { useWorkspaceEntryFlow } = await import("./use-workspace-entry-flow");
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
    const { useWorkspaceEntryFlow } = await import("./use-workspace-entry-flow");
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
    const { useWorkspaceEntryFlow } = await import("./use-workspace-entry-flow");
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
    const { useWorkspaceEntryFlow } = await import("./use-workspace-entry-flow");
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
    mocks.harnessState.pendingWorkspaceEntry = entry;

    const flow = useWorkspaceEntryFlow();
    await expect(flow.finalizeSelection(entry, "cloud-workspace-1")).resolves.toBe(true);

    expect(mocks.materializePendingWorkspaceSessions).toHaveBeenCalledWith(
      entry,
      "cloud-workspace-1",
    );
    expect(mocks.setPendingWorkspaceEntry).toHaveBeenCalledWith(expect.objectContaining({
      attemptId: "attempt-1",
      workspaceId: "cloud-workspace-1",
      errorMessage: null,
    }));
    expect(mocks.setPendingWorkspaceEntry).toHaveBeenLastCalledWith(null);
    expect(mocks.setWorkspaceArrivalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "cloud-workspace-1",
        source: "cloud-created",
      }),
    );
  });
});
