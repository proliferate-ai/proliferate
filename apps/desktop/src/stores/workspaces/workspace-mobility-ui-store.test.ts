import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspaceMobilityUiStore } from "./workspace-mobility-ui-store";

function resetStore() {
  useWorkspaceMobilityUiStore.setState({
    activePromptRequestIdByLogicalWorkspaceId: {},
    confirmSnapshotByLogicalWorkspaceId: {},
    dismissedMcpNoticeByLogicalWorkspaceId: {},
    presentedCompletionByLogicalWorkspaceId: {},
    showMcpNoticeByLogicalWorkspaceId: {},
  });
}

describe("useWorkspaceMobilityUiStore", () => {
  beforeEach(() => {
    resetStore();
  });

  it("does not reopen a dismissed MCP reconnect notice until a new move clears it", () => {
    const store = useWorkspaceMobilityUiStore.getState();

    store.showMcpNotice("logical-1");
    expect(useWorkspaceMobilityUiStore.getState().showMcpNoticeByLogicalWorkspaceId)
      .toEqual({ "logical-1": true });

    useWorkspaceMobilityUiStore.getState().dismissMcpNotice("logical-1");
    expect(useWorkspaceMobilityUiStore.getState().showMcpNoticeByLogicalWorkspaceId)
      .toEqual({ "logical-1": false });
    expect(useWorkspaceMobilityUiStore.getState().dismissedMcpNoticeByLogicalWorkspaceId)
      .toEqual({ "logical-1": true });

    useWorkspaceMobilityUiStore.getState().showMcpNotice("logical-1");
    expect(useWorkspaceMobilityUiStore.getState().showMcpNoticeByLogicalWorkspaceId)
      .toEqual({ "logical-1": false });

    useWorkspaceMobilityUiStore.getState().clearMcpNotice("logical-1");
    useWorkspaceMobilityUiStore.getState().showMcpNotice("logical-1");
    expect(useWorkspaceMobilityUiStore.getState().showMcpNoticeByLogicalWorkspaceId)
      .toEqual({ "logical-1": true });
  });

  it("remembers the presented completion key per logical workspace", () => {
    useWorkspaceMobilityUiStore.getState().markCompletionPresented(
      "logical-1",
      "handoff-1",
    );

    expect(useWorkspaceMobilityUiStore.getState().presentedCompletionByLogicalWorkspaceId)
      .toEqual({ "logical-1": "handoff-1" });

    useWorkspaceMobilityUiStore.getState().markCompletionPresented(
      "logical-1",
      "handoff-1",
    );
    expect(useWorkspaceMobilityUiStore.getState().presentedCompletionByLogicalWorkspaceId)
      .toEqual({ "logical-1": "handoff-1" });

    useWorkspaceMobilityUiStore.getState().markCompletionPresented(
      "logical-1",
      "handoff-2",
    );
    expect(useWorkspaceMobilityUiStore.getState().presentedCompletionByLogicalWorkspaceId)
      .toEqual({ "logical-1": "handoff-2" });
  });
});
