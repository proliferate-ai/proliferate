// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useRightPanelViewerActions } from "#product/hooks/workspaces/workflows/right-panel/use-right-panel-viewer-actions";
import {
  promptAttachmentViewerTarget,
  viewerTargetKey,
} from "#product/lib/domain/workspaces/viewer/viewer-target";

const focusChatInput = vi.hoisted(() => vi.fn());

vi.mock("#product/lib/domain/focus-zone", () => ({ focusChatInput }));

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
      headerOrder: ["tool:scratch", "tool:git"],
    });
  });
});
