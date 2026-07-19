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

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function renderTerminalCreationHook() {
  let rightPanelState: RightPanelWorkspaceState = {
    ...DEFAULT_RIGHT_PANEL_WORKSPACE_STATE,
    headerOrder: [...DEFAULT_RIGHT_PANEL_WORKSPACE_STATE.headerOrder],
  };
  const updateState = vi.fn((value: SetStateAction<RightPanelWorkspaceState>) => {
    rightPanelState = typeof value === "function" ? value(rightPanelState) : value;
  });
  const rendered = renderHook(() => useRightPanelEntryActions({
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
  return {
    ...rendered,
    getRightPanelState: () => rightPanelState,
    updateState,
  };
}

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

  it("keeps final activation in click order when creations resolve in reverse", async () => {
    const firstCreation = createDeferred<string>();
    const secondCreation = createDeferred<string>();
    terminalActions.createTab
      .mockReturnValueOnce(firstCreation.promise)
      .mockReturnValueOnce(secondCreation.promise);
    const { result, getRightPanelState } = renderTerminalCreationHook();

    let firstResult!: Promise<string | null>;
    let secondResult!: Promise<string | null>;
    act(() => {
      firstResult = result.current.createTerminal();
      secondResult = result.current.createTerminal();
    });
    expect(terminalActions.createTab).toHaveBeenCalledTimes(2);

    await act(async () => {
      secondCreation.resolve("terminal-2");
      await Promise.resolve();
    });
    firstCreation.resolve("terminal-1");
    await act(async () => {
      expect(await Promise.all([firstResult, secondResult])).toEqual([
        "terminal-1",
        "terminal-2",
      ]);
    });

    expect(getRightPanelState().activeEntryKey).toBe("terminal:terminal-2");
    expect(getRightPanelState().headerOrder).toEqual(expect.arrayContaining([
      "terminal:terminal-1",
      "terminal:terminal-2",
    ]));
    expect(result.current.terminalFocusNonce).toBe(2);
  });

  it("activates the latest successful click when the newer creation fails", async () => {
    const firstCreation = createDeferred<string>();
    const secondCreation = createDeferred<string>();
    terminalActions.createTab
      .mockReturnValueOnce(firstCreation.promise)
      .mockReturnValueOnce(secondCreation.promise);
    const { result, getRightPanelState } = renderTerminalCreationHook();

    let firstResult!: Promise<string | null>;
    let secondResult!: Promise<string | null>;
    act(() => {
      firstResult = result.current.createTerminal();
      secondResult = result.current.createTerminal();
    });
    secondCreation.reject(new Error("second create failed"));
    firstCreation.resolve("terminal-1");
    await act(async () => {
      expect(await Promise.all([firstResult, secondResult])).toEqual([
        "terminal-1",
        null,
      ]);
    });

    expect(getRightPanelState().activeEntryKey).toBe("terminal:terminal-1");
    expect(getRightPanelState().headerOrder).toContain("terminal:terminal-1");
    expect(result.current.terminalFocusNonce).toBe(1);
  });

  it("activates the newer click when the earlier creation fails", async () => {
    const firstCreation = createDeferred<string>();
    const secondCreation = createDeferred<string>();
    terminalActions.createTab
      .mockReturnValueOnce(firstCreation.promise)
      .mockReturnValueOnce(secondCreation.promise);
    const { result, getRightPanelState } = renderTerminalCreationHook();

    let firstResult!: Promise<string | null>;
    let secondResult!: Promise<string | null>;
    act(() => {
      firstResult = result.current.createTerminal();
      secondResult = result.current.createTerminal();
    });
    secondCreation.resolve("terminal-2");
    firstCreation.reject(new Error("first create failed"));
    await act(async () => {
      expect(await Promise.all([firstResult, secondResult])).toEqual([
        null,
        "terminal-2",
      ]);
    });

    expect(getRightPanelState().activeEntryKey).toBe("terminal:terminal-2");
    expect(getRightPanelState().headerOrder).toContain("terminal:terminal-2");
    expect(result.current.terminalFocusNonce).toBe(1);
  });

  it("does not materialize or focus a phantom terminal when creation fails", async () => {
    terminalActions.createTab.mockRejectedValueOnce(new Error("runtime unavailable"));
    let rightPanelState: RightPanelWorkspaceState = {
      ...DEFAULT_RIGHT_PANEL_WORKSPACE_STATE,
      headerOrder: [...DEFAULT_RIGHT_PANEL_WORKSPACE_STATE.headerOrder],
    };
    const initialState = rightPanelState;
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
      expect(await result.current.createTerminal()).toBeNull();
    });

    expect(rightPanelState).toBe(initialState);
    expect(updateState).not.toHaveBeenCalled();
    expect(result.current.terminalFocusNonce).toBe(0);
  });
});
