/* @vitest-environment jsdom */

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoworkWorkspaceShell } from "#product/components/workspace/cowork/CoworkWorkspaceShell";

const chatViewRender = vi.hoisted(() => vi.fn());

vi.mock("#product/components/workspace/chat/ChatView", () => ({
  ChatView: (props: {
    showWorkspaceStatusPanels?: boolean;
  }) => {
    chatViewRender(props);
    return <div data-testid="chat-view" />;
  },
}));

vi.mock("#product/components/workspace/shell/sidebar/MainSidebar", () => ({
  MainSidebar: () => <div data-testid="main-sidebar" />,
}));

vi.mock("#product/primitives/IconButton", () => ({
  IconButton: ({
    children,
    onClick,
    title,
  }: {
    children: ReactNode;
    onClick?: () => void;
    title?: string;
  }) => (
    <button type="button" aria-label={title} onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock("#product/primitives/icons/app-shell", () => ({
  SplitPanelLeft: () => <span data-testid="split-panel-icon" />,
}));

vi.mock("#product/components/workspace/cowork/CoworkArtifactsPanel", () => ({
  CoworkArtifactsPanel: () => <div data-testid="cowork-artifacts-panel" />,
}));

vi.mock("#product/components/workspace/cowork/CoworkWorkspaceHeader", () => ({
  CoworkWorkspaceHeader: ({ title }: { title: string }) => (
    <div data-testid="cowork-workspace-header">{title}</div>
  ),
}));

const resizeState = vi.hoisted(() => ({
  options: [] as { reverse?: boolean; onResizeEnd?: () => void }[],
}));

vi.mock("#product/hooks/ui/layout/use-resize", () => ({
  useResize: (options: { reverse?: boolean; onResizeEnd?: () => void }) => {
    resizeState.options.push(options);
    return vi.fn();
  },
}));

vi.mock("#product/hooks/shortcuts/lifecycle/use-shortcut-handler", () => ({
  useShortcutHandler: () => {},
}));

const chromeState = vi.hoisted(() => ({ transparent: false }));

vi.mock("#product/hooks/theme/derived/use-transparent-chrome", () => ({
  useTransparentChromeEnabled: () => chromeState.transparent,
}));

const productHostState = vi.hoisted(() => ({ desktop: {} as object | null }));

vi.mock("#product/host/ProductHostProvider", () => ({
  useProductHost: () => productHostState,
}));

const workspaceUiState = vi.hoisted(() => ({
  sidebarOpen: true,
  setSidebarOpen: vi.fn(),
  sidebarWidth: 280,
  setSidebarWidth: vi.fn(),
}));

vi.mock("#product/stores/preferences/workspace-ui-store", () => ({
  useWorkspaceUiStore: (selector: (state: typeof workspaceUiState) => unknown) =>
    selector(workspaceUiState),
}));

const coworkUiState = vi.hoisted(() => ({
  artifactPanelOpenByWorkspaceId: {} as Record<string, boolean>,
  setArtifactPanelOpen: vi.fn(),
}));

vi.mock("#product/stores/cowork/cowork-ui-store", () => ({
  useCoworkUiStore: (selector: (state: typeof coworkUiState) => unknown) =>
    selector(coworkUiState),
}));

const sessionDirectoryState = vi.hoisted(() => ({
  entriesById: {},
}));

vi.mock("#product/stores/sessions/session-directory-store", () => ({
  useSessionDirectoryStore: (selector: (state: typeof sessionDirectoryState) => unknown) =>
    selector(sessionDirectoryState),
}));

const sessionSelectionState = vi.hoisted(() => ({
  activeSessionId: null as string | null,
}));

vi.mock("#product/stores/sessions/session-selection-store", () => ({
  useSessionSelectionStore: (selector: (state: typeof sessionSelectionState) => unknown) =>
    selector(sessionSelectionState),
}));

vi.mock("#product/providers/WorkspacePathProvider", () => ({
  WorkspacePathProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  chromeState.transparent = false;
  productHostState.desktop = {};
  coworkUiState.artifactPanelOpenByWorkspaceId = {};
  resizeState.options.length = 0;
});

describe("CoworkWorkspaceShell", () => {
  it("owns the missing transparent Desktop sidebar edge without adding it to Web", () => {
    chromeState.transparent = true;
    productHostState.desktop = {};
    const { rerender } = render(
      <CoworkWorkspaceShell
        workspaceId="workspace-cowork"
        workspacePath="/tmp/workspace-cowork"
      />,
    );

    expect(document.getElementById("cowork-sidebar")?.className).toContain("border-r");

    productHostState.desktop = null;
    rerender(
      <CoworkWorkspaceShell
        workspaceId="workspace-cowork"
        workspacePath="/tmp/workspace-cowork"
      />,
    );
    expect(document.getElementById("cowork-sidebar")?.className).not.toContain("border-r");
  });

  it("renders chat without standard workspace composer panels", () => {
    render(
      <CoworkWorkspaceShell
        workspaceId="workspace-cowork"
        workspacePath="/tmp/workspace-cowork"
      />,
    );

    expect(chatViewRender).toHaveBeenCalledWith(
      expect.objectContaining({
        showWorkspaceStatusPanels: false,
      }),
    );
  });

  it("drops the artifact pane width easing while the right separator drag is live", () => {
    coworkUiState.artifactPanelOpenByWorkspaceId = { "workspace-cowork": true };
    const { container } = render(
      <CoworkWorkspaceShell
        workspaceId="workspace-cowork"
        workspacePath="/tmp/workspace-cowork"
      />,
    );

    const pane = () => container.querySelector("[data-cowork-artifact-pane]");
    expect(pane()?.className).toContain("transition-[width]");

    // The left separator is labelled with aria-controls; the right one is not.
    const rightSeparator = [...container.querySelectorAll('[role="separator"]')]
      .find((element) => !element.hasAttribute("aria-controls"));
    fireEvent.mouseDown(rightSeparator!);
    expect(pane()?.className).toContain("transition-none");
    expect(pane()?.className).not.toContain("transition-[width]");

    const rightResizeOptions = resizeState.options.filter((options) => options.reverse).at(-1);
    act(() => rightResizeOptions?.onResizeEnd?.());
    expect(pane()?.className).toContain("transition-[width]");
  });

  it("never renders an update affordance in the top-left window chrome", () => {
    for (const sidebarOpen of [true, false]) {
      workspaceUiState.sidebarOpen = sidebarOpen;
      const { queryByTestId, unmount } = render(
        <CoworkWorkspaceShell
          workspaceId="workspace-cowork"
          workspacePath="/tmp/workspace-cowork"
        />,
      );

      // The persistent update affordance lives in the sidebar footer next to
      // help; the top-left chrome carries the sidebar toggle and nothing else.
      expect(queryByTestId("sidebar-update-footer-button")).toBeNull();
      unmount();
    }
    workspaceUiState.sidebarOpen = true;
  });
});
