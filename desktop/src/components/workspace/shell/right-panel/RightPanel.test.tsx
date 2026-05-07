// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState, type Dispatch, type SetStateAction } from "react";
import type { TerminalRecord } from "@anyharness/sdk";
import { useTerminalsQuery } from "@anyharness/sdk-react";
import {
  DEFAULT_RIGHT_PANEL_WORKSPACE_STATE,
  rightPanelBrowserHeaderKey,
  type RightPanelWorkspaceState,
} from "@/lib/domain/workspaces/shell/right-panel";
import { isApplePlatform } from "@/lib/domain/shortcuts/matching";
import { RightPanel } from "@/components/workspace/shell/right-panel/RightPanel";
import { requestRightPanelNewTabMenu } from "@/lib/infra/right-panel-new-tab-menu";

const terminalActionsMocks = vi.hoisted(() => ({
  closeTab: vi.fn(async () => "closed"),
  createTab: vi.fn(async () => "terminal-created"),
  renameTab: vi.fn(async () => undefined),
}));

const terminalStoreMocks = vi.hoisted(() => ({
  setActiveTerminalForWorkspace: vi.fn(),
}));

const toastStoreMocks = vi.hoisted(() => ({
  show: vi.fn(),
}));

const browserPanelMocks = vi.hoisted(() => ({
  WorkspaceBrowserPanel: vi.fn(),
}));

vi.mock("@anyharness/sdk-react", () => ({
  useTerminalsQuery: vi.fn(),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("@/hooks/terminals/use-terminal-actions", () => ({
  useTerminalActions: () => terminalActionsMocks,
}));

vi.mock("@/stores/terminal/terminal-store", () => ({
  useTerminalStore: (selector: (state: {
    setActiveTerminalForWorkspace: typeof terminalStoreMocks.setActiveTerminalForWorkspace;
    unreadByTerminal: Record<string, boolean>;
  }) => unknown) => selector({
    setActiveTerminalForWorkspace: terminalStoreMocks.setActiveTerminalForWorkspace,
    unreadByTerminal: {},
  }),
}));

vi.mock("@/stores/toast/toast-store", () => ({
  useToastStore: (selector: (state: { show: typeof toastStoreMocks.show }) => unknown) =>
    selector({ show: toastStoreMocks.show }),
}));

vi.mock("@/components/workspace/browser/WorkspaceBrowserPanel", () => ({
  WorkspaceBrowserPanel: (props: { isVisible: boolean }) => {
    browserPanelMocks.WorkspaceBrowserPanel(props);
    return <div data-testid="browser-panel" data-visible={String(props.isVisible)} />;
  },
}));

vi.mock("@/components/workspace/files/panel/WorkspaceFilesPanel", () => ({
  WorkspaceFilesPanel: () => (
    <div data-testid="files-panel">
      <input data-testid="files-panel-input" />
    </div>
  ),
}));

vi.mock("@/components/workspace/git/GitPanel", () => ({
  GitPanel: () => <div data-testid="git-panel" />,
}));

vi.mock("@/components/workspace/terminals/TerminalPanel", () => ({
  TerminalPanel: ({
    activeTerminalId,
  }: {
    activeTerminalId: string | null;
  }) => (
    <div
      data-testid="terminal-panel"
      data-active-terminal-id={activeTerminalId ?? ""}
    />
  ),
}));

vi.mock("@/components/cloud/workspace-settings/CloudWorkspaceSettingsPanel", () => ({
  CloudWorkspaceSettingsPanel: () => <div data-testid="settings-panel" />,
}));

beforeEach(() => {
  vi.mocked(useTerminalsQuery).mockImplementation((options) => {
    const enabled = Boolean((options as { enabled?: boolean } | undefined)?.enabled);
    return ({
      data: enabled ? [] : undefined,
      isError: false,
      isLoading: !enabled,
      isSuccess: Boolean(enabled),
      refetch: vi.fn(async () => ({ data: [] })),
    }) as unknown as ReturnType<typeof useTerminalsQuery>;
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("RightPanel terminal activation", () => {
  it("creates one default terminal lazily without leaving the Files panel", async () => {
    render(<RightPanelHarness isWorkspaceReady />);

    await waitFor(() => expect(terminalActionsMocks.createTab).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("files-panel")).toBeTruthy();
  });

  it("opens the new tab menu with Terminal focused from a right-panel request", async () => {
    const terminal = terminalRecord("terminal-1");
    vi.mocked(useTerminalsQuery).mockImplementation((options) => {
      const enabled = Boolean((options as { enabled?: boolean } | undefined)?.enabled);
      return ({
        data: enabled ? [terminal] : undefined,
        isError: false,
        isLoading: !enabled,
        isSuccess: Boolean(enabled),
        refetch: vi.fn(async () => ({ data: [terminal] })),
      }) as unknown as ReturnType<typeof useTerminalsQuery>;
    });

    render(<RightPanelHarness isWorkspaceReady />);

    requestRightPanelNewTabMenu("terminal");

    const terminalButton = await screen.findByRole("button", { name: "Terminal" });
    const browserButton = screen.getByRole("button", { name: "Browser" });
    await waitFor(() => expect(document.activeElement).toBe(terminalButton));

    fireEvent.keyDown(terminalButton, { key: "ArrowDown" });
    expect(document.activeElement).toBe(browserButton);

    fireEvent.keyDown(browserButton, { key: "ArrowUp" });
    expect(document.activeElement).toBe(terminalButton);
  });

  it("replays no-id terminal activation once workspace content becomes renderable", async () => {
    const terminal = terminalRecord("terminal-1");
    const refetch = vi.fn(async () => ({ data: [terminal] }));
    vi.mocked(useTerminalsQuery).mockImplementation((options) => {
      const enabled = Boolean((options as { enabled?: boolean } | undefined)?.enabled);
      return ({
        data: enabled ? [terminal] : undefined,
        isError: false,
        isLoading: !enabled,
        isSuccess: Boolean(enabled),
        refetch,
      }) as unknown as ReturnType<typeof useTerminalsQuery>;
    });

    const rendered = render(
      <RightPanelHarness isWorkspaceReady={false} terminalActivationRequestToken={1} />,
    );

    expect(refetch).not.toHaveBeenCalled();

    rendered.rerender(
      <RightPanelHarness isWorkspaceReady terminalActivationRequestToken={1} />,
    );

    await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(screen.getByTestId("terminal-panel").dataset.activeTerminalId).toBe(
        "terminal-1",
      );
    });
  });

  it("does not replay deferred activation for a different workspace", () => {
    const terminal = terminalRecord("terminal-1");
    const refetch = vi.fn(async () => ({ data: [terminal] }));
    vi.mocked(useTerminalsQuery).mockImplementation((options) => {
      const enabled = Boolean((options as { enabled?: boolean } | undefined)?.enabled);
      return ({
        data: enabled ? [terminal] : undefined,
        isError: false,
        isLoading: !enabled,
        isSuccess: Boolean(enabled),
        refetch,
      }) as unknown as ReturnType<typeof useTerminalsQuery>;
    });

    render(
      <RightPanelHarness
        isWorkspaceReady
        terminalActivationRequestToken={1}
        terminalActivationRequestWorkspaceId="workspace-a"
        workspaceId="workspace-b"
      />,
    );

    expect(refetch).not.toHaveBeenCalled();
    expect(terminalStoreMocks.setActiveTerminalForWorkspace).not.toHaveBeenCalledWith(
      "workspace-b",
      "terminal-1",
    );
  });

  it("does not replay a handled activation request after remount", async () => {
    const terminal = terminalRecord("terminal-1");
    const refetch = vi.fn(async () => ({ data: [terminal] }));
    vi.mocked(useTerminalsQuery).mockImplementation((options) => {
      const enabled = Boolean((options as { enabled?: boolean } | undefined)?.enabled);
      return ({
        data: enabled ? [terminal] : undefined,
        isError: false,
        isLoading: !enabled,
        isSuccess: Boolean(enabled),
        refetch,
      }) as unknown as ReturnType<typeof useTerminalsQuery>;
    });

    const rendered = render(<RemountingRightPanelHarness mounted />);

    await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1));

    rendered.rerender(<RemountingRightPanelHarness mounted={false} />);
    rendered.rerender(<RemountingRightPanelHarness mounted />);

    await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1));
  });
});

describe("RightPanel browser visibility", () => {
  it("passes collapsed right-panel state to native browser surfaces", () => {
    render(
      <RightPanelHarness
        isOpen={false}
        isWorkspaceReady
        initialState={{
          ...DEFAULT_RIGHT_PANEL_WORKSPACE_STATE,
          activeEntryKey: rightPanelBrowserHeaderKey("b1"),
          headerOrder: [
            ...DEFAULT_RIGHT_PANEL_WORKSPACE_STATE.headerOrder,
            rightPanelBrowserHeaderKey("b1"),
          ],
          browserTabsById: {
            b1: { id: "b1", url: "http://localhost:3000/" },
          },
        }}
      />,
    );

    expect(browserPanelMocks.WorkspaceBrowserPanel).toHaveBeenCalledWith(
      expect.objectContaining({ isVisible: false }),
    );
    expect(screen.getByTestId("browser-panel").dataset.visible).toBe("false");
  });

  it("passes app overlay state to native browser surfaces", () => {
    render(
      <RightPanelHarness
        isWorkspaceReady
        nativeOverlaysHidden
        initialState={{
          ...DEFAULT_RIGHT_PANEL_WORKSPACE_STATE,
          activeEntryKey: rightPanelBrowserHeaderKey("b1"),
          headerOrder: [
            ...DEFAULT_RIGHT_PANEL_WORKSPACE_STATE.headerOrder,
            rightPanelBrowserHeaderKey("b1"),
          ],
          browserTabsById: {
            b1: { id: "b1", url: "http://localhost:3000/" },
          },
        }}
      />,
    );

    expect(browserPanelMocks.WorkspaceBrowserPanel).toHaveBeenCalledWith(
      expect.objectContaining({
        isVisible: true,
        nativeOverlaysHidden: true,
      }),
    );
  });
});

describe("RightPanel tab shortcuts", () => {
  it("uses primary-number shortcuts after clicking non-focusable panel content", async () => {
    const { container } = render(<RightPanelHarness isWorkspaceReady />);
    const root = container.querySelector("[data-right-panel-root='true']");
    if (!(root instanceof HTMLElement)) {
      throw new Error("Expected right panel root");
    }

    fireEvent.pointerDown(root);
    expect(document.activeElement).toBe(root);

    fireEvent.keyDown(window, primaryDigitEvent(2));

    await waitFor(() => expect(screen.getByTestId("git-panel")).toBeTruthy());
  });

  it("uses primary-number shortcuts from right-panel text inputs", async () => {
    render(<RightPanelHarness isWorkspaceReady />);
    const input = screen.getByTestId("files-panel-input");

    input.focus();
    expect(document.activeElement).toBe(input);

    fireEvent.keyDown(window, primaryDigitEvent(2));

    await waitFor(() => expect(screen.getByTestId("git-panel")).toBeTruthy());
  });
});

describe("RightPanel root focus requests", () => {
  it("focuses the root when an open panel receives a root focus token", async () => {
    const rendered = render(<RightPanelHarness isWorkspaceReady focusRequestToken={0} />);
    const root = rendered.container.querySelector("[data-right-panel-root='true']");
    if (!(root instanceof HTMLElement)) {
      throw new Error("Expected right panel root");
    }

    expect(document.activeElement).not.toBe(root);

    rendered.rerender(<RightPanelHarness isWorkspaceReady focusRequestToken={1} />);

    await waitFor(() => expect(document.activeElement).toBe(root));
  });

  it("does not focus the root while the panel is closed", async () => {
    const rendered = render(
      <RightPanelHarness isWorkspaceReady isOpen={false} focusRequestToken={1} />,
    );
    const root = rendered.container.querySelector("[data-right-panel-root='true']");
    if (!(root instanceof HTMLElement)) {
      throw new Error("Expected right panel root");
    }

    await Promise.resolve();

    expect(document.activeElement).not.toBe(root);
  });
});

function RightPanelHarness({
  initialState = DEFAULT_RIGHT_PANEL_WORKSPACE_STATE,
  isOpen = true,
  isWorkspaceReady,
  focusRequestToken = 0,
  nativeOverlaysHidden = false,
  terminalActivationRequestToken,
  terminalActivationRequestWorkspaceId,
  workspaceId = "workspace-1",
}: {
  initialState?: RightPanelWorkspaceState;
  isOpen?: boolean;
  isWorkspaceReady: boolean;
  focusRequestToken?: number;
  nativeOverlaysHidden?: boolean;
  terminalActivationRequestToken?: number;
  terminalActivationRequestWorkspaceId?: string;
  workspaceId?: string;
}) {
  const [state, setState] = useState(initialState);
  return (
    <RightPanel
      workspaceId={workspaceId}
      isWorkspaceReady={isWorkspaceReady}
      isOpen={isOpen}
      isCloudWorkspaceSelected
      state={state}
      repoSettingsHref="/settings"
      onStateChange={setState as Dispatch<SetStateAction<RightPanelWorkspaceState>>}
      focusRequestToken={focusRequestToken}
      nativeOverlaysHidden={nativeOverlaysHidden}
      terminalActivationRequest={terminalActivationRequestToken
        ? {
            token: terminalActivationRequestToken,
            workspaceId: terminalActivationRequestWorkspaceId ?? workspaceId,
          }
        : null}
      onTerminalActivationRequestHandled={() => undefined}
    />
  );
}

function RemountingRightPanelHarness({
  mounted,
}: {
  mounted: boolean;
}) {
  const [state, setState] = useState(DEFAULT_RIGHT_PANEL_WORKSPACE_STATE);
  const [terminalActivationRequest, setTerminalActivationRequest] = useState<{
    token: number;
    workspaceId: string;
  } | null>({
    token: 1,
    workspaceId: "workspace-1",
  });

  if (!mounted) {
    return null;
  }

  return (
    <RightPanel
      workspaceId="workspace-1"
      isWorkspaceReady
      isOpen
      isCloudWorkspaceSelected
      state={state}
      repoSettingsHref="/settings"
      onStateChange={setState as Dispatch<SetStateAction<RightPanelWorkspaceState>>}
      terminalActivationRequest={terminalActivationRequest}
      onTerminalActivationRequestHandled={(request) => {
        setTerminalActivationRequest((current) =>
          current?.workspaceId === request.workspaceId && current.token === request.token
            ? null
            : current
        );
      }}
    />
  );
}

function terminalRecord(id: string): TerminalRecord {
  return {
    commandRun: null,
    createdAt: "2026-01-01T00:00:00Z",
    cwd: "/workspace",
    exitCode: null,
    id,
    purpose: "user",
    status: "running",
    title: "Terminal",
    updatedAt: "2026-01-01T00:00:00Z",
    workspaceId: "workspace-1",
  } as unknown as TerminalRecord;
}

function primaryDigitEvent(digit: number) {
  return {
    key: String(digit),
    code: `Digit${digit}`,
    ...(isApplePlatform() ? { metaKey: true } : { ctrlKey: true }),
  };
}
