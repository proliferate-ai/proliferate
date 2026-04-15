import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";

const mocks = vi.hoisted(() => ({
  selectWorkspace: vi.fn(),
  enterPendingWorkspaceShell: vi.fn(),
  setPendingWorkspaceEntry: vi.fn(),
  setWorkspaceArrivalEvent: vi.fn(),
  resetWorkspaceFiles: vi.fn(),
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

vi.mock("@/stores/editor/workspace-files-store", () => ({
  useWorkspaceFilesStore: {
    getState: () => ({
      reset: mocks.resetWorkspaceFiles,
    }),
  },
}));

vi.mock("@/stores/sessions/harness-store", () => {
  const useHarnessStore = Object.assign(
    (selector: (state: typeof mocks.harnessState) => unknown) =>
      selector(mocks.harnessState),
    {
      getState: () => mocks.harnessState,
    },
  );
  return { useHarnessStore };
});

vi.mock("@/lib/infra/debug-latency", () => ({
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
  });
});
