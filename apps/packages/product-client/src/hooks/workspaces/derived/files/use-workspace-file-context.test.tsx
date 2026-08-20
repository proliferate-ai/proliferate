// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import type { Workspace } from "@anyharness/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetFileTreeStoreForTests,
  useFileTreeStore,
} from "#product/stores/editor/file-tree-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useWorkspaceFileContext } from "#product/hooks/workspaces/derived/files/use-workspace-file-context";

const mocks = vi.hoisted(() => ({
  useWorkspaces: vi.fn(),
}));

vi.mock("#product/hooks/workspaces/cache/use-workspaces", () => ({
  useWorkspaces: mocks.useWorkspaces,
}));

describe("useWorkspaceFileContext", () => {
  beforeEach(() => {
    resetFileTreeStoreForTests();
    useSessionSelectionStore.getState().clearSelection();
    mocks.useWorkspaces.mockReturnValue({ data: undefined });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    resetFileTreeStoreForTests();
    useSessionSelectionStore.getState().clearSelection();
  });

  function withCollections(): void {
    mocks.useWorkspaces.mockReturnValue({
      data: {
        workspaces: [workspace({
          id: "workspace-1",
          repoRootId: "repo-root-1",
          path: "/repo/proliferate",
        })],
      },
    });
  }

  it("derives the workspace ui key and file-tree key from selected workspace state", () => {
    mocks.useWorkspaces.mockReturnValue({
      data: {
        workspaces: [workspace({
          id: "workspace-1",
          repoRootId: "repo-root-1",
          path: "/repo/proliferate",
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
      treeStateKey: "repo-root-1",
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

  it("derives a pre-collections candidate without claiming or dispatching anything", () => {
    useSessionSelectionStore.getState().activateWorkspace({
      logicalWorkspaceId: null,
      workspaceId: "workspace-1",
    });

    const { result, rerender } = renderHook(() => useWorkspaceFileContext());

    expect(result.current.treeStateKey).toBe("workspace-1");
    // Pure/read-only: no registry entry, no expansion scope, no durable write.
    expect(useFileTreeStore.getState().firstTreeStateKeyByMaterializedWorkspace.size).toBe(0);
    expect(useFileTreeStore.getState().expandedPathsByMaterializedWorkspace.size).toBe(0);
    expect(useFileTreeStore.getState().durableRevision).toBe(0);

    // With no claim, the pure derivation follows the enriched candidate.
    withCollections();
    rerender();
    expect(result.current.treeStateKey).toBe("repo-root-1");
  });

  it("keeps the controller-claimed first key across unmount and later enrichment", () => {
    useSessionSelectionStore.getState().activateWorkspace({
      logicalWorkspaceId: null,
      workspaceId: "workspace-1",
    });

    const first = renderHook(() => useWorkspaceFileContext());
    // The sole dock controller claims the derived candidate in its layout
    // lifecycle; the hook itself never writes.
    useFileTreeStore.getState().claimFileTreeStateKey("workspace-1", "workspace-1");
    expect(first.result.current.treeStateKey).toBe("workspace-1");
    first.unmount();

    withCollections();
    const second = renderHook(() => useWorkspaceFileContext());

    expect(second.result.current).toEqual({
      workspaceUiKey: "workspace-1",
      materializedWorkspaceId: "workspace-1",
      treeStateKey: "workspace-1",
    });
    // A second instance can only read the claimed value.
    useFileTreeStore.getState().claimFileTreeStateKey("workspace-1", "repo-root-1");
    expect(second.result.current.treeStateKey).toBe("workspace-1");
  });

  it("accepts the current candidate for a genuinely new materialization after disposal", () => {
    useSessionSelectionStore.getState().activateWorkspace({
      logicalWorkspaceId: null,
      workspaceId: "workspace-1",
    });
    useFileTreeStore.getState().claimFileTreeStateKey("workspace-1", "workspace-1");
    useFileTreeStore.getState().pruneFileTreeSessionState("workspace-1");

    withCollections();
    const { result } = renderHook(() => useWorkspaceFileContext());
    useFileTreeStore.getState().claimFileTreeStateKey("workspace-1", "repo-root-1");

    expect(result.current.treeStateKey).toBe("repo-root-1");
  });
});

function workspace(input: {
  id: string;
  repoRootId: string;
  path: string;
}): Workspace {
  return {
    availability: "available",
    id: input.id,
    kind: "local",
    repoRootId: input.repoRootId,
    path: input.path,
    surface: "standard",
    lifecycleState: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}
