// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode, SetStateAction } from "react";
import type { CurrentPullRequestResponse } from "@anyharness/sdk";
import {
  DEFAULT_RIGHT_PANEL_WORKSPACE_STATE,
  type RightPanelWorkspaceState,
} from "@/lib/domain/workspaces/right-panel";
import { openExternal } from "@/platform/tauri/shell";
import { useMainScreenActions } from "./use-main-screen-actions";
import type { MainScreenLayoutState } from "./use-main-screen-state";

vi.mock("@anyharness/sdk-react", () => ({
  useRenameGitBranchMutation: () => ({
    mutateAsync: vi.fn(),
  }),
}));

vi.mock("@/hooks/workspaces/use-workspace-runtime-block", () => ({
  useWorkspaceRuntimeBlock: () => ({
    getWorkspaceRuntimeBlockReason: vi.fn(() => null),
  }),
}));

vi.mock("@/stores/sessions/harness-connection-store", () => ({
  useHarnessConnectionStore: (selector: (state: { runtimeUrl: string }) => unknown) =>
    selector({ runtimeUrl: "http://localhost:3000" }),
}));

vi.mock("@/stores/sessions/session-selection-store", () => ({
  useSessionSelectionStore: (selector: (state: { selectedWorkspaceId: string }) => unknown) =>
    selector({ selectedWorkspaceId: "workspace-1" }),
}));

vi.mock("@/stores/toast/toast-store", () => ({
  useToastStore: (selector: (state: { show: (message: string) => void }) => unknown) =>
    selector({ show: vi.fn() }),
}));

vi.mock("@/platform/tauri/shell", () => ({
  openExternal: vi.fn(async () => undefined),
}));

vi.mock("@/lib/integrations/cloud/workspaces", () => ({
  updateCloudWorkspaceBranch: vi.fn(async () => undefined),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useMainScreenActions publish actions", () => {
  it("opens commit, push, and PR dialogs without opening the right panel", () => {
    const { result, spies } = renderActions();

    act(() => result.current.handleCommitOpen());
    expect(spies.setPublishDialog).toHaveBeenLastCalledWith({
      open: true,
      initialIntent: "commit",
      workspaceId: "workspace-1",
    });

    act(() => result.current.handlePushOpen());
    expect(spies.setPublishDialog).toHaveBeenLastCalledWith({
      open: true,
      initialIntent: "publish",
      workspaceId: "workspace-1",
    });

    act(() => result.current.handlePrOpen());
    expect(spies.setPublishDialog).toHaveBeenLastCalledWith({
      open: true,
      initialIntent: "pull_request",
      workspaceId: "workspace-1",
    });

    expect(spies.setRightPanelState).not.toHaveBeenCalled();
    expect(spies.setRightPanelOpen).not.toHaveBeenCalled();
    expect(spies.requestRightPanelFocus).not.toHaveBeenCalled();
  });

  it("opens PRs from the publish dialog without opening the right panel", () => {
    const { result, spies } = renderActions();

    act(() => result.current.handlePublishDialogViewPr(pullRequest()));

    expect(openExternal).toHaveBeenCalledWith("https://github.test/pull/1");
    expect(spies.setRightPanelState).not.toHaveBeenCalled();
    expect(spies.setRightPanelOpen).not.toHaveBeenCalled();
    expect(spies.requestRightPanelFocus).not.toHaveBeenCalled();
  });

});

describe("useMainScreenActions right panel actions", () => {
  it("opens singleton right-panel tools by writing an active entry key", () => {
    const { result, spies } = renderActions();

    act(() => result.current.onSetRightPanelTool("files"));

    expect(spies.setRightPanelOpen).toHaveBeenCalledWith(true);
    const nextState = applyRightPanelStateUpdate(
      DEFAULT_RIGHT_PANEL_WORKSPACE_STATE,
      lastCallArg(spies.setRightPanelState),
    );
    expect(nextState.activeEntryKey).toBe("tool:files");
    expect(spies.requestRightPanelFocus).toHaveBeenCalledTimes(1);
  });

  it("opens a concrete terminal by adding and selecting its header entry", () => {
    const { result, spies } = renderActions();

    act(() => result.current.openTerminalPanel("terminal-1"));

    expect(spies.setRightPanelOpen).toHaveBeenCalledWith(true);
    expect(spies.setTerminalActivationRequest).toHaveBeenCalledTimes(1);
    const nextState = applyRightPanelStateUpdate(
      DEFAULT_RIGHT_PANEL_WORKSPACE_STATE,
      lastCallArg(spies.setRightPanelState),
    );
    expect(nextState.activeEntryKey).toBe("terminal:terminal-1");
    expect(nextState.headerOrder).toContain("terminal:terminal-1");
    expect(applyTerminalActivationRequestUpdate(
      null,
      lastCallArg<MainScreenLayoutState["terminalActivationRequest"]>(
        spies.setTerminalActivationRequest,
      ),
    )).toEqual({ token: 1, workspaceId: "workspace-1" });
    expect(spies.requestRightPanelFocus).not.toHaveBeenCalled();
  });

  it("opens terminal panel without an id by preserving state and bumping activation", () => {
    const { result, spies } = renderActions();

    act(() => result.current.openTerminalPanel());

    expect(spies.setRightPanelOpen).toHaveBeenCalledWith(true);
    expect(spies.setTerminalActivationRequest).toHaveBeenCalledTimes(1);
    expect(applyTerminalActivationRequestUpdate(
      null,
      lastCallArg<MainScreenLayoutState["terminalActivationRequest"]>(
        spies.setTerminalActivationRequest,
      ),
    )).toEqual({ token: 1, workspaceId: "workspace-1" });
    expect(spies.setRightPanelState).not.toHaveBeenCalled();
    expect(spies.requestRightPanelFocus).not.toHaveBeenCalled();
  });

  it("toggles a closed right panel to files when a singleton tool is active", () => {
    const { result, spies } = renderActions({
      rightPanelState: {
        ...DEFAULT_RIGHT_PANEL_WORKSPACE_STATE,
        activeEntryKey: "tool:settings",
      },
      rightPanelOpen: false,
    });

    act(() => result.current.toggleRightPanel());

    const nextState = applyRightPanelStateUpdate(
      DEFAULT_RIGHT_PANEL_WORKSPACE_STATE,
      lastCallArg(spies.setRightPanelState),
    );
    expect(nextState.activeEntryKey).toBe("tool:files");
    expect(spies.setRightPanelOpen).toHaveBeenCalledWith(true);
    expect(spies.requestRightPanelFocus).toHaveBeenCalledTimes(1);
  });

  it("toggles a closed right panel from a live entry without rewriting selection", () => {
    const { result, spies } = renderActions({
      rightPanelState: {
        ...DEFAULT_RIGHT_PANEL_WORKSPACE_STATE,
        activeEntryKey: "browser:b1",
        headerOrder: [...DEFAULT_RIGHT_PANEL_WORKSPACE_STATE.headerOrder, "browser:b1"],
        browserTabsById: {
          b1: { id: "b1", url: null },
        },
      },
      rightPanelOpen: false,
    });

    act(() => result.current.toggleRightPanel());

    expect(spies.setRightPanelOpen).toHaveBeenCalledWith(true);
    expect(spies.setRightPanelState).not.toHaveBeenCalled();
    expect(spies.requestRightPanelFocus).toHaveBeenCalledTimes(1);
  });

  it("closes an open right panel without requesting root focus", () => {
    const { result, spies } = renderActions({
      rightPanelOpen: true,
    });

    act(() => result.current.toggleRightPanel());

    expect(spies.setRightPanelOpen).toHaveBeenCalledWith(false);
    expect(spies.requestRightPanelFocus).not.toHaveBeenCalled();
  });
});

function renderActions(overrides: Partial<MainScreenLayoutState> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  const { layout, spies } = mainScreenLayout(overrides);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const rendered = renderHook(
    () => useMainScreenActions({ layout, existingPr: null }),
    { wrapper },
  );

  return {
    ...rendered,
    spies,
  };
}

function mainScreenLayout(overrides: Partial<MainScreenLayoutState> = {}): {
  layout: MainScreenLayoutState;
  spies: {
    setPublishDialog: ReturnType<typeof vi.fn>;
    requestRightPanelFocus: ReturnType<typeof vi.fn>;
    setRightPanelOpen: ReturnType<typeof vi.fn>;
    setRightPanelState: ReturnType<typeof vi.fn>;
    setTerminalActivationRequest: ReturnType<typeof vi.fn>;
  };
} {
  const setPublishDialog = vi.fn();
  const requestRightPanelFocus = vi.fn();
  const setRightPanelOpen = vi.fn();
  const setRightPanelState = vi.fn();
  const setTerminalActivationRequest = vi.fn();

  return {
    layout: {
      rightPanelState: DEFAULT_RIGHT_PANEL_WORKSPACE_STATE,
      setRightPanelState,
      sidebarOpen: true,
      setSidebarOpen: vi.fn(),
      sidebarWidth: 280,
      setSidebarWidth: vi.fn(),
      rightPanelOpen: false,
      setRightPanelOpen,
      rightPanelFocusRequestToken: 0,
      requestRightPanelFocus,
      terminalActivationRequest: null,
      setTerminalActivationRequest,
      publishDialog: {
        open: false,
        initialIntent: "commit",
        workspaceId: null,
      },
      setPublishDialog,
      commandPaletteOpen: false,
      setCommandPaletteOpen: vi.fn(),
      rightPanelWidth: 420,
      setRightPanelWidth: vi.fn(),
      onLeftSeparatorDown: vi.fn(),
      onRightSeparatorDown: vi.fn(),
      ...overrides,
    },
    spies: {
      setPublishDialog,
      requestRightPanelFocus,
      setRightPanelOpen,
      setRightPanelState,
      setTerminalActivationRequest,
    },
  };
}

function applyRightPanelStateUpdate(
  previous: RightPanelWorkspaceState,
  value: SetStateAction<RightPanelWorkspaceState> | undefined,
): RightPanelWorkspaceState {
  if (!value) {
    throw new Error("Expected right panel state update");
  }
  return typeof value === "function" ? value(previous) : value;
}

function lastCallArg<T = RightPanelWorkspaceState>(
  mock: ReturnType<typeof vi.fn>,
): SetStateAction<T> | undefined {
  const calls = mock.mock.calls;
  return calls[calls.length - 1]?.[0] as SetStateAction<T> | undefined;
}

function applyTerminalActivationRequestUpdate(
  previous: MainScreenLayoutState["terminalActivationRequest"],
  value: SetStateAction<MainScreenLayoutState["terminalActivationRequest"]> | undefined,
): MainScreenLayoutState["terminalActivationRequest"] {
  if (!value) {
    throw new Error("Expected terminal activation request update");
  }
  return typeof value === "function" ? value(previous) : value;
}

function pullRequest(): NonNullable<CurrentPullRequestResponse["pullRequest"]> {
  return {
    title: "Existing",
    url: "https://github.test/pull/1",
    state: "open",
    number: 1,
    headBranch: "feature/demo",
    baseBranch: "main",
    draft: false,
  };
}
