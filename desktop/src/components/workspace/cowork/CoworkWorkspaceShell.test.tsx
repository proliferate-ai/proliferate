/* @vitest-environment jsdom */

import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoworkWorkspaceShell } from "@/components/workspace/cowork/CoworkWorkspaceShell";

const chatViewRender = vi.hoisted(() => vi.fn());

vi.mock("@/components/workspace/chat/ChatView", () => ({
  ChatView: (props: { showWorkspaceFooter?: boolean }) => {
    chatViewRender(props);
    return <div data-testid="chat-view" />;
  },
}));

vi.mock("@/components/workspace/shell/sidebar/MainSidebar", () => ({
  MainSidebar: () => <div data-testid="main-sidebar" />,
}));

vi.mock("@/components/workspace/shell/sidebar/SidebarUpdatePill", () => ({
  SidebarUpdatePill: () => <div data-testid="sidebar-update-pill" />,
}));

vi.mock("@proliferate/ui/primitives/IconButton", () => ({
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

vi.mock("@/components/ui/icons", () => ({
  SplitPanel: () => <span data-testid="split-panel-icon" />,
}));

vi.mock("@/components/workspace/cowork/CoworkArtifactsPanel", () => ({
  CoworkArtifactsPanel: () => <div data-testid="cowork-artifacts-panel" />,
}));

vi.mock("@/components/workspace/cowork/CoworkWorkspaceHeader", () => ({
  CoworkWorkspaceHeader: ({ title }: { title: string }) => (
    <div data-testid="cowork-workspace-header">{title}</div>
  ),
}));

vi.mock("@/hooks/ui/layout/use-resize", () => ({
  useResize: () => vi.fn(),
}));

vi.mock("@/hooks/shortcuts/lifecycle/use-shortcut-handler", () => ({
  useShortcutHandler: () => {},
}));

vi.mock("@/hooks/theme/derived/use-transparent-chrome", () => ({
  useTransparentChromeEnabled: () => false,
}));

vi.mock("@/hooks/access/tauri/use-updater", () => ({
  useUpdater: () => ({
    phase: "idle",
    downloadProgress: null,
    downloadUpdate: vi.fn(),
    openRestartPrompt: vi.fn(),
  }),
}));

const workspaceUiState = vi.hoisted(() => ({
  sidebarOpen: true,
  setSidebarOpen: vi.fn(),
  sidebarWidth: 280,
  setSidebarWidth: vi.fn(),
}));

vi.mock("@/stores/preferences/workspace-ui-store", () => ({
  useWorkspaceUiStore: (selector: (state: typeof workspaceUiState) => unknown) =>
    selector(workspaceUiState),
}));

const coworkUiState = vi.hoisted(() => ({
  artifactPanelOpenByWorkspaceId: {},
  setArtifactPanelOpen: vi.fn(),
}));

vi.mock("@/stores/cowork/cowork-ui-store", () => ({
  useCoworkUiStore: (selector: (state: typeof coworkUiState) => unknown) =>
    selector(coworkUiState),
}));

const sessionDirectoryState = vi.hoisted(() => ({
  entriesById: {},
}));

vi.mock("@/stores/sessions/session-directory-store", () => ({
  useSessionDirectoryStore: (selector: (state: typeof sessionDirectoryState) => unknown) =>
    selector(sessionDirectoryState),
}));

const sessionSelectionState = vi.hoisted(() => ({
  activeSessionId: null as string | null,
}));

vi.mock("@/stores/sessions/session-selection-store", () => ({
  useSessionSelectionStore: (selector: (state: typeof sessionSelectionState) => unknown) =>
    selector(sessionSelectionState),
}));

vi.mock("@/providers/WorkspacePathProvider", () => ({
  WorkspacePathProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CoworkWorkspaceShell", () => {
  it("renders chat without the standard workspace footer", () => {
    render(
      <CoworkWorkspaceShell
        workspaceId="workspace-cowork"
        workspacePath="/tmp/workspace-cowork"
      />,
    );

    expect(chatViewRender).toHaveBeenCalledWith(
      expect.objectContaining({ showWorkspaceFooter: false }),
    );
  });
});
