import { beforeEach, describe, expect, it } from "vitest";
import { createManualChatGroupId } from "@/lib/domain/workspaces/tabs/manual-groups";
import { chatWorkspaceShellTabKey } from "@/lib/domain/workspaces/tabs/shell-tabs";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import { beginReplacementShellPreferences } from "./session-replacement-shell-preferences";

describe("replacement shell preferences", () => {
  beforeEach(() => {
    useWorkspaceUiStore.setState({
      shellTabOrderByWorkspace: {},
      visibleChatSessionIdsByWorkspace: {},
      manualChatGroupsByWorkspace: {},
    });
  });

  it("preserves position and grouping across a successful identity swap", () => {
    seedPreferences();

    beginReplacementShellPreferences({
      shellWorkspaceId: "workspace-1",
      materializedWorkspaceId: "workspace-1",
      replacedSessionId: "old",
      replacementSessionId: "new",
    });

    const state = useWorkspaceUiStore.getState();
    expect(state.shellTabOrderByWorkspace["workspace-1"]).toEqual([
      "file:README.md",
      chatWorkspaceShellTabKey("new"),
      chatWorkspaceShellTabKey("other"),
    ]);
    expect(state.visibleChatSessionIdsByWorkspace["workspace-1"])
      .toEqual(["new", "other"]);
    expect(state.manualChatGroupsByWorkspace["workspace-1"]?.[0]?.sessionIds)
      .toEqual(["new", "other"]);
  });

  it("rolls back only its identity mapping while preserving concurrent tab edits", () => {
    seedPreferences();
    const transaction = beginReplacementShellPreferences({
      shellWorkspaceId: "workspace-1",
      materializedWorkspaceId: "workspace-1",
      replacedSessionId: "old",
      replacementSessionId: "new",
    });
    const state = useWorkspaceUiStore.getState();
    state.setShellTabOrderForWorkspace("workspace-1", [
      "file:README.md",
      chatWorkspaceShellTabKey("new"),
      chatWorkspaceShellTabKey("extra"),
      chatWorkspaceShellTabKey("other"),
    ]);
    state.setVisibleChatSessionIdsForWorkspace(
      "workspace-1",
      ["new", "extra", "other"],
    );
    state.setManualChatGroupsForWorkspace("workspace-1", [{
      id: createManualChatGroupId("group-1"),
      label: "Renamed while pending",
      colorId: "magenta",
      sessionIds: ["new", "extra", "other"],
    }]);

    transaction.rollback();

    const rolledBack = useWorkspaceUiStore.getState();
    expect(rolledBack.shellTabOrderByWorkspace["workspace-1"]).toEqual([
      "file:README.md",
      chatWorkspaceShellTabKey("old"),
      chatWorkspaceShellTabKey("extra"),
      chatWorkspaceShellTabKey("other"),
    ]);
    expect(rolledBack.visibleChatSessionIdsByWorkspace["workspace-1"])
      .toEqual(["old", "extra", "other"]);
    expect(rolledBack.manualChatGroupsByWorkspace["workspace-1"]?.[0]).toEqual({
      id: createManualChatGroupId("group-1"),
      label: "Renamed while pending",
      colorId: "magenta",
      sessionIds: ["old", "extra", "other"],
    });
  });

  it("rolls back a logical key populated from the materialized fallback while pending", () => {
    seedPreferences("workspace-runtime");
    const transaction = beginReplacementShellPreferences({
      shellWorkspaceId: "workspace-logical",
      materializedWorkspaceId: "workspace-runtime",
      replacedSessionId: "old",
      replacementSessionId: "new",
    });
    const state = useWorkspaceUiStore.getState();
    state.setShellTabOrderForWorkspace(
      "workspace-logical",
      [...(state.shellTabOrderByWorkspace["workspace-runtime"] ?? [])],
    );
    state.setVisibleChatSessionIdsForWorkspace(
      "workspace-logical",
      [...(state.visibleChatSessionIdsByWorkspace["workspace-runtime"] ?? [])],
    );
    state.setManualChatGroupsForWorkspace(
      "workspace-logical",
      (state.manualChatGroupsByWorkspace["workspace-runtime"] ?? []).map((group) => ({
        ...group,
        sessionIds: [...group.sessionIds],
      })),
    );

    transaction.rollback();

    const rolledBack = useWorkspaceUiStore.getState();
    for (const workspaceId of ["workspace-logical", "workspace-runtime"]) {
      expect(rolledBack.shellTabOrderByWorkspace[workspaceId]).toEqual([
        "file:README.md",
        chatWorkspaceShellTabKey("old"),
        chatWorkspaceShellTabKey("other"),
      ]);
      expect(rolledBack.visibleChatSessionIdsByWorkspace[workspaceId])
        .toEqual(["old", "other"]);
      expect(rolledBack.manualChatGroupsByWorkspace[workspaceId]?.[0]?.sessionIds)
        .toEqual(["old", "other"]);
    }
  });
});

function seedPreferences(workspaceId = "workspace-1"): void {
  const state = useWorkspaceUiStore.getState();
  state.setShellTabOrderForWorkspace(workspaceId, [
    "file:README.md",
    chatWorkspaceShellTabKey("old"),
    chatWorkspaceShellTabKey("other"),
  ]);
  state.setVisibleChatSessionIdsForWorkspace(workspaceId, ["old", "other"]);
  state.setManualChatGroupsForWorkspace(workspaceId, [{
    id: createManualChatGroupId("group-1"),
    label: "Pair",
    colorId: "blue",
    sessionIds: ["old", "other"],
  }]);
}
