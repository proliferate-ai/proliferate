// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SetStateAction } from "react";
import {
  DEFAULT_RIGHT_PANEL_WORKSPACE_STATE,
  type RightPanelWorkspaceState,
} from "#product/lib/domain/workspaces/shell/right-panel-model";
import { useRightPanelEntryActions } from "#product/hooks/workspaces/workflows/right-panel/use-right-panel-entry-actions";

const terminalActions = vi.hoisted(() => ({
  createTab: vi.fn<(workspaceId: string) => Promise<string>>(),
  closeTab: vi.fn(),
  renameTab: vi.fn(),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("#product/hooks/terminals/workflows/use-terminal-actions", () => ({
  useTerminalActions: () => terminalActions,
}));

vi.mock("#product/hooks/workspaces/derived/use-workspace-runtime-block", () => ({
  useWorkspaceRuntimeBlock: () => ({
    getWorkspaceRuntimeBlockReason: vi.fn(() => null),
  }),
}));

vi.mock("#product/hooks/workspaces/workflows/right-panel/use-right-panel-viewer-actions", () => ({
  useRightPanelViewerActions: () => ({
    selectViewer: vi.fn(),
    handleCloseViewer: vi.fn(),
  }),
}));

vi.mock("#product/stores/toast/toast-store", () => ({
  useToastStore: (selector: (state: { show: (message: string) => void }) => unknown) =>
    selector({ show: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useRightPanelEntryActions terminal creation", () => {
  it("activates distinct terminals and requests focus once per creation", async () => {
    terminalActions.createTab
      .mockResolvedValueOnce("terminal-1")
      .mockResolvedValueOnce("terminal-2");
    let rightPanelState: RightPanelWorkspaceState = {
      ...DEFAULT_RIGHT_PANEL_WORKSPACE_STATE,
      headerOrder: [...DEFAULT_RIGHT_PANEL_WORKSPACE_STATE.headerOrder],
    };
    const updateState = vi.fn((value: SetStateAction<RightPanelWorkspaceState>) => {
      rightPanelState = typeof value === "function" ? value(rightPanelState) : value;
    });
    const { result } = renderHook(() => useRightPanelEntryActions({
      workspaceId: "workspace-1",
      shouldRenderContent: true,
      isCloudWorkspaceSelected: false,
      state: rightPanelState,
      repoSettingsHref: "/settings",
      terminalsQuery: { refetch: vi.fn(async () => ({ data: [] })) },
      activeTerminalId: null,
      openViewerTargets: [],
      buffersByPath: {},
      updateState,
      setActiveTerminalForWorkspace: vi.fn(),
      closeViewerTarget: vi.fn(),
      reorderViewerTargets: vi.fn(),
      setActiveViewerTarget: vi.fn(),
      clearBuffer: vi.fn(),
    }));

    await act(async () => {
      expect(await result.current.createTerminal()).toBe("terminal-1");
    });
    expect(rightPanelState.activeEntryKey).toBe("terminal:terminal-1");
    expect(rightPanelState.headerOrder).toContain("terminal:terminal-1");
    expect(result.current.terminalFocusNonce).toBe(1);

    await act(async () => {
      expect(await result.current.createTerminal()).toBe("terminal-2");
    });
    expect(rightPanelState.activeEntryKey).toBe("terminal:terminal-2");
    expect(rightPanelState.headerOrder).toEqual(expect.arrayContaining([
      "terminal:terminal-1",
      "terminal:terminal-2",
    ]));
    expect(new Set(rightPanelState.headerOrder).size).toBe(rightPanelState.headerOrder.length);
    expect(result.current.terminalFocusNonce).toBe(2);
    expect(terminalActions.createTab).toHaveBeenNthCalledWith(1, "workspace-1");
    expect(terminalActions.createTab).toHaveBeenNthCalledWith(2, "workspace-1");
  });
});
