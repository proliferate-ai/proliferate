// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { CurrentPullRequestResponse } from "@anyharness/sdk";
import { DEFAULT_RIGHT_PANEL_WORKSPACE_STATE } from "@/lib/domain/workspaces/right-panel";
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

vi.mock("@/stores/sessions/harness-store", () => ({
  useHarnessStore: (selector: (state: { runtimeUrl: string; selectedWorkspaceId: string }) => unknown) =>
    selector({
      runtimeUrl: "http://localhost:3000",
      selectedWorkspaceId: "workspace-1",
    }),
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
  });

  it("opens PRs from the publish dialog without opening the right panel", () => {
    const { result, spies } = renderActions();

    act(() => result.current.handlePublishDialogViewPr(pullRequest()));

    expect(openExternal).toHaveBeenCalledWith("https://github.test/pull/1");
    expect(spies.setRightPanelState).not.toHaveBeenCalled();
    expect(spies.setRightPanelOpen).not.toHaveBeenCalled();
  });

  it("opens a requested terminal without adding terminal header entries", () => {
    const { result, spies } = renderActions();

    act(() => {
      expect(result.current.openTerminalPanel("terminal-1")).toBe(true);
    });

    expect(spies.setRightPanelOpen).toHaveBeenCalledWith(true);
    expect(spies.setRightPanelState).toHaveBeenCalledTimes(1);
    const update = spies.setRightPanelState.mock.calls[0]![0] as (
      previous: MainScreenLayoutState["rightPanelState"],
    ) => MainScreenLayoutState["rightPanelState"];
    const next = update({
      ...DEFAULT_RIGHT_PANEL_WORKSPACE_STATE,
      headerOrder: ["tool:files", "tool:git", "tool:terminal", "tool:settings"],
    });

    expect(next.activeTool).toBe("terminal");
    expect(next.activeTerminalId).toBe("terminal-1");
    expect(next.terminalOrder).toEqual(["terminal-1"]);
    expect(next.headerOrder).toEqual(["tool:files", "tool:git", "tool:terminal", "tool:settings"]);
  });
});

function renderActions() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  const { layout, spies } = mainScreenLayout();
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

function mainScreenLayout(): {
  layout: MainScreenLayoutState;
  spies: {
    setPublishDialog: ReturnType<typeof vi.fn>;
    setRightPanelOpen: ReturnType<typeof vi.fn>;
    setRightPanelState: ReturnType<typeof vi.fn>;
  };
} {
  const setPublishDialog = vi.fn();
  const setRightPanelOpen = vi.fn();
  const setRightPanelState = vi.fn();

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
      terminalActivationRequestToken: 0,
      setTerminalActivationRequestToken: vi.fn(),
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
    },
    spies: {
      setPublishDialog,
      setRightPanelOpen,
      setRightPanelState,
    },
  };
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
