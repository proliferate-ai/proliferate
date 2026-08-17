/* @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RightPanelTool } from "#product/lib/domain/workspaces/shell/right-panel-model";
import { RightPanelContent } from "./RightPanelContent";

let activeSessionId: string | null = "session-1";

vi.mock("#product/hooks/chat/derived/use-active-session-identity", () => ({
  useActiveSessionId: () => activeSessionId,
}));

vi.mock("#product/components/workspace/activity/background-pane/BackgroundWorkPane", () => ({
  BackgroundWorkPane: (props: { workspaceId: string; sessionId: string; isOpen: boolean }) => (
    <div
      data-testid="background-work-pane"
      data-workspace-id={props.workspaceId}
      data-session-id={props.sessionId}
      data-is-open={String(props.isOpen)}
    />
  ),
}));
vi.mock("#product/components/workspace/delegated-work/agents-pane/AgentsPane", () => ({
  AgentsPane: () => <div data-testid="agents-pane" />,
}));
vi.mock("#product/components/workflows/run-view/WorkflowPane", () => ({
  WorkflowPane: () => <div data-testid="workflow-pane" />,
}));
vi.mock("#product/components/workspace/git/GitPanel", () => ({
  GitPanel: () => <div data-testid="git-panel" />,
}));
vi.mock("#product/components/workspace/scratch/ScratchPadPanel", () => ({
  ScratchPadPanel: () => <div data-testid="scratch-pad-panel" />,
}));
vi.mock("#product/components/workspace/terminals/TerminalPanel", () => ({
  TerminalPanel: () => <div data-testid="terminal-panel" />,
}));
vi.mock("#product/components/workspace/files/FileEditorView", () => ({
  FileEditorView: () => <div data-testid="file-editor-view" />,
}));
vi.mock("#product/components/workspace/files/PromptAttachmentViewer", () => ({
  PromptAttachmentViewer: () => <div data-testid="prompt-attachment-viewer" />,
}));
vi.mock("#product/components/workspace/shell/right-panel/RightPanelPlaceholder", () => ({
  RightPanelPlaceholder: () => <div data-testid="right-panel-placeholder" />,
}));

function baseProps(overrides: Partial<Parameters<typeof RightPanelContent>[0]> = {}) {
  return {
    workspaceId: "workspace-1",
    workspaceUiKey: "workspace-1",
    activeEntryKey: "tool:background" as const,
    activeTool: "background" as RightPanelTool | null,
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
    onNewTerminal: () => {},
    onSelectTerminal: () => {},
    onCloseTerminal: () => {},
    onRenameTerminal: async () => {},
    ...overrides,
  };
}

afterEach(() => {
  activeSessionId = "session-1";
  cleanup();
});

describe("RightPanelContent — background tool branch", () => {
  it("mounts BackgroundWorkPane with the workspace/session/isOpen props when the background tool is active", () => {
    render(<RightPanelContent {...baseProps()} />);

    const pane = screen.getByTestId("background-work-pane");
    expect(pane.getAttribute("data-workspace-id")).toBe("workspace-1");
    expect(pane.getAttribute("data-session-id")).toBe("session-1");
    expect(pane.getAttribute("data-is-open")).toBe("true");
    expect(screen.queryByTestId("agents-pane")).toBeNull();
    expect(screen.queryByTestId("git-panel")).toBeNull();
    expect(screen.queryByTestId("workflow-pane")).toBeNull();
  });

  it("does not mount BackgroundWorkPane when there is no active session", () => {
    activeSessionId = null;
    render(<RightPanelContent {...baseProps()} />);

    expect(screen.queryByTestId("background-work-pane")).toBeNull();
  });

  it("does not mount BackgroundWorkPane for other active tools", () => {
    render(<RightPanelContent {...baseProps({ activeTool: "agents", activeEntryKey: "tool:agents" })} />);

    expect(screen.queryByTestId("background-work-pane")).toBeNull();
    expect(screen.getByTestId("agents-pane")).toBeTruthy();
  });
});
