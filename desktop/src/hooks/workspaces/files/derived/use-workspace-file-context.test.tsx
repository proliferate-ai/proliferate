// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import type { Workspace } from "@anyharness/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useWorkspaceFileContext } from "./use-workspace-file-context";

const mocks = vi.hoisted(() => ({
  useWorkspaces: vi.fn(),
}));

vi.mock("@/hooks/workspaces/cache/use-workspaces", () => ({
  useWorkspaces: mocks.useWorkspaces,
}));

describe("useWorkspaceFileContext", () => {
  beforeEach(() => {
    useSessionSelectionStore.getState().clearSelection();
    mocks.useWorkspaces.mockReturnValue({ data: undefined });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    useSessionSelectionStore.getState().clearSelection();
  });

  it("derives the workspace ui key and file-tree key from selected workspace state", () => {
    mocks.useWorkspaces.mockReturnValue({
      data: {
        workspaces: [workspace({
          id: "workspace-1",
          sourceRepoRootPath: "/repo/proliferate",
        })],
      },
    });
    useSessionSelectionStore.getState().activateWorkspace({
      logicalWorkspaceId: "logical-1",
      workspaceId: "workspace-1",
    });

    const { result } = renderHook(() => useWorkspaceFileContext());

    expect(result.current).toEqual({
      workspaceUiKey: "logical-1",
      materializedWorkspaceId: "workspace-1",
      treeStateKey: "/repo/proliferate",
    });
  });

  it("falls back to the materialized workspace id while collections are loading", () => {
    useSessionSelectionStore.getState().activateWorkspace({
      logicalWorkspaceId: null,
      workspaceId: "workspace-1",
    });

    const { result } = renderHook(() => useWorkspaceFileContext());

    expect(result.current).toEqual({
      workspaceUiKey: "workspace-1",
      materializedWorkspaceId: "workspace-1",
      treeStateKey: "workspace-1",
    });
  });

  it("keeps the initialized fallback file-tree key when collections finish loading", () => {
    useSessionSelectionStore.getState().activateWorkspace({
      logicalWorkspaceId: null,
      workspaceId: "workspace-1",
    });

    const { result, rerender } = renderHook(() => useWorkspaceFileContext());

    expect(result.current.treeStateKey).toBe("workspace-1");

    mocks.useWorkspaces.mockReturnValue({
      data: {
        workspaces: [workspace({
          id: "workspace-1",
          sourceRepoRootPath: "/repo/proliferate",
        })],
      },
    });
    rerender();

    expect(result.current).toEqual({
      workspaceUiKey: "workspace-1",
      materializedWorkspaceId: "workspace-1",
      treeStateKey: "workspace-1",
    });
  });
});

function workspace(input: {
  id: string;
  sourceRepoRootPath: string;
}): Workspace {
  return {
    id: input.id,
    kind: "local",
    path: input.sourceRepoRootPath,
    sourceRepoRootPath: input.sourceRepoRootPath,
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as Workspace;
}
