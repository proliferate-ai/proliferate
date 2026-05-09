import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildSubmittingPendingWorkspaceEntry } from "@/lib/domain/workspaces/creation/pending-entry";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";

const mocks = vi.hoisted(() => ({
  selectWorkspace: vi.fn(),
  enterPendingWorkspaceShell: vi.fn(),
  setPendingWorkspaceEntry: vi.fn(),
  setWorkspaceArrivalEvent: vi.fn(),
  resetWorkspaceFiles: vi.fn(),
  requestChatInputFocus: vi.fn(),
  harnessState: {
    pendingWorkspaceEntry: null,
    enterPendingWorkspaceShell: vi.fn(),
    setPendingWorkspaceEntry: vi.fn(),
    setWorkspaceArrivalEvent: vi.fn(),
  },
}));

vi.mock("react", () => ({
  useCallback: <T extends (...args: never[]) => unknown>(callback: T) => callback,
}));

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
    mocks.harnessState.enterPendingWorkspaceShell = mocks.enterPendingWorkspaceShell;
    mocks.harnessState.setPendingWorkspaceEntry = mocks.setPendingWorkspaceEntry;
    mocks.harnessState.setWorkspaceArrivalEvent = mocks.setWorkspaceArrivalEvent;
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
    expect(mocks.enterPendingWorkspaceShell).toHaveBeenCalledWith(entry);
    expect(mocks.requestChatInputFocus).toHaveBeenCalledTimes(1);
  });
});
