// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fileDiffViewerTarget,
  fileViewerTarget,
} from "#product/lib/domain/workspaces/viewer/viewer-target";
import {
  useWorkspaceFileTargetActions,
} from "#product/hooks/workspaces/workflows/files/use-workspace-file-target-actions";
import type {
  WorkspaceFileContext,
} from "#product/hooks/workspaces/derived/files/use-workspace-file-context";

const activateViewerTarget = vi.hoisted(() => vi.fn());

vi.mock("#product/hooks/workspaces/workflows/tabs/use-workspace-shell-activation", () => ({
  useWorkspaceShellActivation: () => ({ activateViewerTarget }),
}));

const fileContext = {
  materializedWorkspaceId: "workspace-1",
  workspaceUiKey: "logical-workspace-1",
} as WorkspaceFileContext;

function actions() {
  return renderHook(() => useWorkspaceFileTargetActions(fileContext)).result;
}

beforeEach(() => {
  activateViewerTarget.mockReset();
});

describe("useWorkspaceFileTargetActions focus intent", () => {
  it("forwards the canonical viewer default when the caller states no intent", async () => {
    const result = actions();

    await act(async () => {
      await result.current.openFile("src/index.tsx");
    });

    expect(activateViewerTarget).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      shellWorkspaceId: "logical-workspace-1",
      target: fileViewerTarget("src/index.tsx"),
      // Undefined resolves to `"viewer"` inside the sole request owner, so
      // chat/transcript/command-palette/Changes origins focus the viewer.
      focus: undefined,
    });
  });

  it("forwards a tree-origin preserve-origin intent unchanged", async () => {
    const result = actions();

    await act(async () => {
      await result.current.openFile("src/index.tsx", { focus: "preserve-origin" });
    });

    expect(activateViewerTarget).toHaveBeenCalledWith(
      expect.objectContaining({ focus: "preserve-origin" }),
    );
  });

  it("forwards the intent for diff targets too", async () => {
    const result = actions();

    await act(async () => {
      await result.current.openFileDiff("src/index.tsx", { focus: "preserve-origin" });
    });

    expect(activateViewerTarget).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      shellWorkspaceId: "logical-workspace-1",
      target: fileDiffViewerTarget({
        path: "src/index.tsx",
        scope: "unstaged",
        baseRef: null,
        oldPath: null,
      }),
      focus: "preserve-origin",
    });
  });
});
