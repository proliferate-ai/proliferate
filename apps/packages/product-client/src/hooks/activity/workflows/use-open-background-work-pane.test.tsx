// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WORKSPACE_UI_DEFAULTS } from "#product/lib/domain/preferences/workspace-ui/model";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useWorkspaceUiStore } from "#product/stores/preferences/workspace-ui-store";
import { useOpenBackgroundWorkPane } from "./use-open-background-work-pane";

const mocks = vi.hoisted(() => ({
  useWorkspaces: vi.fn(),
}));

vi.mock("#product/hooks/workspaces/cache/use-workspaces", () => ({
  useWorkspaces: mocks.useWorkspaces,
}));

describe("useOpenBackgroundWorkPane", () => {
  beforeEach(() => {
    useSessionSelectionStore.getState().clearSelection();
    mocks.useWorkspaces.mockReturnValue({ data: undefined });
    useWorkspaceUiStore.setState({
      ...WORKSPACE_UI_DEFAULTS,
      _hydrated: true,
      shellActivationEpochByWorkspace: {},
      pendingChatActivationByWorkspace: {},
      urgentHighlightedChatSessionByWorkspace: {},
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    useSessionSelectionStore.getState().clearSelection();
  });

  it("does nothing when no workspace is selected", () => {
    const { result } = renderHook(() => useOpenBackgroundWorkPane());

    act(() => {
      result.current();
    });

    expect(useWorkspaceUiStore.getState().rightPanelMaterializedByWorkspace).toEqual({});
    expect(useWorkspaceUiStore.getState().rightPanelDurableByWorkspace).toEqual({});
  });

  it("materializes the background tool and opens the panel for the active workspace", () => {
    useSessionSelectionStore.getState().activateWorkspace({
      logicalWorkspaceId: "logical-1",
      workspaceId: "workspace-1",
    });

    const { result } = renderHook(() => useOpenBackgroundWorkPane());

    act(() => {
      result.current();
    });

    expect(
      useWorkspaceUiStore.getState().rightPanelMaterializedByWorkspace["workspace-1"],
    ).toMatchObject({ activeEntryKey: "tool:background" });
    expect(
      useWorkspaceUiStore.getState().rightPanelMaterializedByWorkspace["workspace-1"]?.headerOrder,
    ).toContain("tool:background");
    expect(useWorkspaceUiStore.getState().rightPanelDurableByWorkspace["logical-1"])
      .toMatchObject({ open: true });
  });

  it("does not duplicate the background entry in the header order when opened twice", () => {
    useSessionSelectionStore.getState().activateWorkspace({
      logicalWorkspaceId: "logical-1",
      workspaceId: "workspace-1",
    });

    const { result } = renderHook(() => useOpenBackgroundWorkPane());

    act(() => {
      result.current();
      result.current();
    });

    const headerOrder = useWorkspaceUiStore.getState()
      .rightPanelMaterializedByWorkspace["workspace-1"]?.headerOrder ?? [];
    expect(headerOrder.filter((key) => key === "tool:background")).toHaveLength(1);
  });
});
