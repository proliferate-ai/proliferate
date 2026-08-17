// @vitest-environment jsdom

import type { ComponentProps } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RightPanelContent } from "#product/components/workspace/shell/right-panel/RightPanelContent";
import { RightPanelHeaderEntryList } from "#product/components/workspace/shell/right-panel/RightPanelHeaderEntryList";
import { RightPanelPlaceholder } from "#product/components/workspace/shell/right-panel/RightPanelPlaceholder";
import { DEFAULT_RIGHT_PANEL_TOOL_ORDER } from "#product/lib/domain/workspaces/shell/right-panel-model";

vi.mock("#product/components/workspace/delegated-work/agents-pane/AgentsPane", () => ({
  AgentsPane: ({ workspaceId }: { workspaceId: string }) => (
    <div data-testid="agents-pane">Agents for {workspaceId}</div>
  ),
}));

vi.mock("#product/components/workspace/files/FileEditorView", () => ({
  FileEditorView: () => <div data-testid="file-editor" />,
}));

vi.mock("#product/components/workspace/files/PromptAttachmentViewer", () => ({
  PromptAttachmentViewer: () => <div data-testid="prompt-attachment" />,
}));

vi.mock("#product/components/workspace/git/GitPanel", () => ({
  GitPanel: () => <div data-testid="git-panel" />,
}));

vi.mock("#product/components/workspace/scratch/ScratchPadPanel", () => ({
  ScratchPadPanel: () => <div data-testid="scratch-panel" />,
}));

vi.mock("#product/components/workspace/terminals/TerminalPanel", () => ({
  TerminalPanel: () => <div data-testid="terminal-panel" />,
}));

afterEach(cleanup);

function renderRightPanelContent(
  overrides: Partial<ComponentProps<typeof RightPanelContent>> = {},
) {
  const props = {
    workspaceId: "workspace-1",
    workspaceUiKey: "workspace-ui-1",
    activeEntryKey: "tool:agents",
    activeTool: "agents",
    isOpen: true,
    activeTerminalId: null,
    activeViewerTarget: null,
    orderedTerminals: [],
    shouldRenderContent: true,
    shouldMountTerminalPanel: false,
    isWorkspaceReady: true,
    canConnectTerminals: true,
    isLoadingTerminals: false,
    terminalListErrorMessage: null,
    terminalFocusRequestToken: 0,
    unreadByTerminal: {},
    onNewTerminal: vi.fn(),
    onSelectTerminal: vi.fn(),
    onCloseTerminal: vi.fn(),
    onRenameTerminal: vi.fn(async () => undefined),
    ...overrides,
  } satisfies ComponentProps<typeof RightPanelContent>;
  return render(<RightPanelContent {...props} />);
}

describe("Agents right-panel shell", () => {
  it("renders Agents as a real third tool tab with its icon and selection behavior", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <RightPanelHeaderEntryList
        entries={[{ key: "tool:agents", kind: "tool", tool: "agents" }]}
        activeEntryKey="tool:agents"
        unreadByTerminal={{}}
        buffersByPath={{}}
        tabModes={{}}
        isWorkspaceReady
        drag={{
          draggedHeaderKey: null,
          showEndDropIndicator: false,
          getEntryDragState: () => ({
            isDragging: false,
            dragOffsetX: 0,
            showDropIndicator: false,
          }),
          registerHeaderEntryNode: () => undefined,
          handleHeaderPointerDown: () => undefined,
          handleHeaderPointerMove: () => undefined,
          finishHeaderPointerDrag: () => undefined,
          cancelHeaderPointerDrag: () => undefined,
          shouldSuppressHeaderClick: () => false,
        }}
        shortcutRevealVisible={false}
        onActivateEntry={() => {
          onSelect();
          return true;
        }}
        onCloseTerminal={() => undefined}
        onCloseViewerTarget={() => undefined}
        onRenameTerminal={async () => undefined}
      />,
    );

    const tab = screen.getByRole("tab", { name: "Agents" });
    expect(DEFAULT_RIGHT_PANEL_TOOL_ORDER).toEqual(["scratch", "git", "agents", "background"]);
    expect(tab.getAttribute("aria-selected")).toBe("true");
    expect(tab.getAttribute("aria-controls"))
      .toBe("tabpanel-workspace-right-panel-agents");
    expect(tab.querySelector("svg")).not.toBeNull();

    fireEvent.click(tab);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("mounts the Agents pane for the active tool and passes the exact workspace", () => {
    renderRightPanelContent();

    expect(screen.getByTestId("agents-pane").textContent)
      .toBe("Agents for workspace-1");
    expect(screen.queryByTestId("scratch-panel")).toBeNull();
    expect(screen.queryByTestId("git-panel")).toBeNull();
  });

  it("uses the Agents-specific workspace-loading placeholder", () => {
    render(
      <RightPanelPlaceholder activeEntryKey="tool:agents" />,
    );

    expect(screen.getByText("Agents are getting ready")).toBeTruthy();
    expect(screen.getByText(
      "Delegated agents will appear here as soon as the workspace finishes loading.",
    )).toBeTruthy();
  });

  it("keeps that placeholder in the right-panel content lane before readiness", () => {
    renderRightPanelContent({ shouldRenderContent: false });

    expect(screen.getByText("Agents are getting ready")).toBeTruthy();
    expect(screen.queryByTestId("agents-pane")).toBeNull();
  });
});
