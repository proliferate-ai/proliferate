// @vitest-environment jsdom

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { HeaderStripRow } from "@/lib/domain/workspaces/tabs/group-rows";
import type { DisplayManualChatGroup } from "@/lib/domain/workspaces/tabs/manual-groups";
import type { ShellChatTab } from "@/lib/domain/workspaces/tabs/shell-rows";
import { WORKSPACE_UI_DEFAULTS } from "@/lib/domain/preferences/workspace-ui/model";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useWorkspaceShellTabsState } from "@/hooks/workspaces/ui/tabs/use-workspace-shell-tabs-state";

const EMPTY_MANUAL_GROUPS: readonly DisplayManualChatGroup[] = [];
const EMPTY_CHILDREN = new Map<string, readonly string[]>();

const CHAT_TAB: ShellChatTab = {
  id: "session-1",
  sessionId: "session-1",
  parentSessionId: null,
  groupRootSessionId: "session-1",
  isChild: false,
  visualGroupId: null,
};

const STRIP_ROWS: HeaderStripRow<ShellChatTab>[] = [{
  kind: "tab",
  tab: CHAT_TAB,
}];

beforeEach(() => {
  useWorkspaceUiStore.setState({
    ...WORKSPACE_UI_DEFAULTS,
    _hydrated: true,
    activeShellTabKeyByWorkspace: {},
    shellTabOrderByWorkspace: {},
    shellActivationEpochByWorkspace: {},
    pendingChatActivationByWorkspace: {},
  });
  useSessionSelectionStore.getState().clearSelection();
  useSessionSelectionStore.setState({
    _hydrated: true,
    selectedLogicalWorkspaceId: null,
    selectedWorkspaceId: "workspace-1",
    workspaceSelectionNonce: 1,
  });
});

describe("useWorkspaceShellTabsState", () => {
  it("uses stable empty preference fallbacks before shell tab state is persisted", async () => {
    const renderCounts: number[] = [];

    const { result } = renderHook(() => {
      renderCounts.push(renderCounts.length + 1);
      return useWorkspaceShellTabsState({
        workspaceUiKey: "workspace-1",
        materializedWorkspaceId: "workspace-1",
        activeSessionId: "session-1",
        shellChatSessionIds: ["session-1"],
        stripRows: STRIP_ROWS,
        displayManualGroups: EMPTY_MANUAL_GROUPS,
        subagentChildIdsByParentId: EMPTY_CHILDREN,
      });
    });

    expect(result.current.orderedShellTabKeys).toEqual(["chat:session-1"]);
    expect(result.current.activeShellTabKey).toBe("chat:session-1");

    await waitFor(() => {
      expect(useWorkspaceUiStore.getState().shellTabOrderByWorkspace["workspace-1"])
        .toEqual(["chat:session-1"]);
    });

    expect(renderCounts.length).toBeLessThan(10);
  });
});
