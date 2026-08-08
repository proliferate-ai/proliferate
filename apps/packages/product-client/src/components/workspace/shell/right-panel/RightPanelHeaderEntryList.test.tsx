// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RightPanelHeaderEntryList,
} from "#product/components/workspace/shell/right-panel/RightPanelHeaderEntryList";
import { useAgentsPaneStore } from "#product/stores/agents/agents-pane-store";
import type {
  RightPanelHeaderDragController,
} from "#product/hooks/workspaces/ui/use-right-panel-header-drag";

const drag: RightPanelHeaderDragController = {
  draggedHeaderKey: null,
  showEndDropIndicator: false,
  getEntryDragState: () => ({
    isDragging: false,
    dragOffsetX: 0,
    showDropIndicator: false,
  }),
  registerHeaderEntryNode: () => {},
  handleHeaderPointerDown: () => {},
  handleHeaderPointerMove: () => {},
  finishHeaderPointerDrag: () => {},
  cancelHeaderPointerDrag: () => {},
  shouldSuppressHeaderClick: () => false,
};

function renderList(onActivateEntry = vi.fn(() => true)) {
  render(
    <RightPanelHeaderEntryList
      entries={[{ kind: "tool", key: "tool:agents", tool: "agents" }]}
      activeEntryKey="tool:agents"
      unreadByTerminal={{}}
      buffersByPath={{}}
      tabModes={{}}
      isWorkspaceReady
      drag={drag}
      shortcutRevealVisible={false}
      onActivateEntry={onActivateEntry}
      onCloseTerminal={() => {}}
      onCloseViewerTarget={() => {}}
      onRenameTerminal={async () => {}}
    />,
  );
  return onActivateEntry;
}

afterEach(() => {
  cleanup();
  useAgentsPaneStore.setState({ view: { kind: "overview" } });
});

describe("RightPanelHeaderEntryList", () => {
  it("points the agents pane at the overview when its panel tab is clicked", () => {
    // ADR §4: the panel's own Agents tab is an entry point to the OVERVIEW.
    // Without this it reappears wherever it was last pointed — which, after a
    // "N working" cap click, is another session's agent detail.
    useAgentsPaneStore.setState({
      view: { kind: "agent", sessionId: "s1", sessionLinkId: "link-1" },
    });

    const onActivateEntry = renderList();
    fireEvent.click(screen.getByLabelText("Agents"));

    expect(useAgentsPaneStore.getState().view).toEqual({ kind: "overview" });
    expect(onActivateEntry).toHaveBeenCalledWith("tool:agents");
  });
});
