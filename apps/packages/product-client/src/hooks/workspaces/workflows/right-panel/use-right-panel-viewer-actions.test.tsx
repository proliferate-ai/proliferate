// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useRightPanelViewerActions } from "#product/hooks/workspaces/workflows/right-panel/use-right-panel-viewer-actions";
import {
  fileViewerTarget,
  promptAttachmentViewerTarget,
  viewerTargetKey,
} from "#product/lib/domain/workspaces/viewer/viewer-target";

const focusChatInput = vi.hoisted(() => vi.fn());
const activateViewerTarget = vi.hoisted(() => vi.fn());

vi.mock("#product/lib/domain/focus-zone", () => ({ focusChatInput }));
vi.mock("#product/hooks/workspaces/workflows/tabs/use-workspace-shell-activation", () => ({
  useWorkspaceShellActivation: () => ({ activateViewerTarget }),
}));

describe("useRightPanelViewerActions", () => {
  it("closes a prompt attachment without clearing file buffers and recovers composer focus", () => {
    const target = promptAttachmentViewerTarget({
      origin: "draft",
      attachmentId: "draft-1",
      name: "notes.md",
      mimeType: "text/markdown",
      attachmentKind: "text_resource",
      attachmentSource: "upload",
      objectUrl: "blob:draft-1",
    });
    const targetKey = viewerTargetKey(target);
    const state = {
      activeEntryKey: targetKey,
      headerOrder: ["tool:scratch" as const, "tool:git" as const, targetKey],
    };
    const updateState = vi.fn();
    const closeViewerTarget = vi.fn();
    const setActiveViewerTarget = vi.fn();
    const clearBuffer = vi.fn();
    focusChatInput.mockReset();

    const { result } = renderHook(() => useRightPanelViewerActions({
      workspaceId: "workspace-1",
      shellWorkspaceId: "logical-workspace-1",
      state,
      isCloudWorkspaceSelected: true,
      openViewerTargets: [target],
      buffersByPath: {},
      updateState,
      closeViewerTarget,
      setActiveViewerTarget,
      clearBuffer,
    }));

    act(() => {
      result.current.handleCloseViewer(targetKey);
    });

    expect(closeViewerTarget).toHaveBeenCalledWith(targetKey);
    expect(clearBuffer).not.toHaveBeenCalled();
    expect(setActiveViewerTarget).not.toHaveBeenCalled();
    expect(focusChatInput).toHaveBeenCalledOnce();
    const update = updateState.mock.calls[0]?.[0];
    expect(typeof update).toBe("function");
    expect(update(state)).toEqual({
      activeEntryKey: "tool:git",
      // `availableRightPanelTools` leads with `workflow` ahead of the default
      // scratch/git/agents/background order when workflows v2 is enabled (see
      // that function's docstring) — normalization appends missing tools in
      // that order, so `workflow` lands before `agents`/`background` here.
      headerOrder: ["tool:scratch", "tool:git", "tool:workflow", "tool:agents", "tool:background"],
    });
  });

  it("selects a viewer header entry through the canonical activation contract with preserve-origin", () => {
    const target = fileViewerTarget("src/index.tsx");
    const targetKey = viewerTargetKey(target);
    const setActiveViewerTarget = vi.fn();
    const updateState = vi.fn();
    activateViewerTarget.mockReset();

    const { result } = renderHook(() => useRightPanelViewerActions({
      workspaceId: "workspace-1",
      shellWorkspaceId: "logical-workspace-1",
      state: { activeEntryKey: "tool:git" as const, headerOrder: ["tool:git" as const] },
      isCloudWorkspaceSelected: false,
      openViewerTargets: [target],
      buffersByPath: {},
      updateState,
      closeViewerTarget: vi.fn(),
      setActiveViewerTarget,
      clearBuffer: vi.fn(),
    }));

    act(() => {
      result.current.selectViewer(targetKey);
    });

    // The direct store bypass is gone: the canonical owner performs the
    // selection (and its suppressed search dismissal) instead.
    expect(setActiveViewerTarget).not.toHaveBeenCalled();
    expect(activateViewerTarget).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      shellWorkspaceId: "logical-workspace-1",
      target,
      focus: "preserve-origin",
    });
    expect(updateState).toHaveBeenCalledOnce();
  });
});
