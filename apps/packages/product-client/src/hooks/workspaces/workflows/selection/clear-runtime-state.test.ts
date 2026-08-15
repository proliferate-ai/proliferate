import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearWorkspaceRuntimeState,
} from "#product/hooks/workspaces/workflows/selection/clear-runtime-state";
import {
  EMPTY_PENDING_WORKSPACE_REGISTRY,
  upsertPendingWorkspaceEntry,
} from "#product/lib/domain/workspaces/creation/pending-entry-registry";
import type {
  PendingWorkspaceEntry,
} from "#product/lib/domain/workspaces/creation/pending-entry";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";

function buildEntry(attemptId: string): PendingWorkspaceEntry {
  return {
    attemptId,
    source: "worktree-created",
    stage: "submitting",
    displayName: `pending-${attemptId}`,
    repoLabel: "acme/repo",
    baseBranchName: "main",
    workspaceId: null,
    request: { kind: "local", sourceRoot: "/repo" },
    originTarget: { kind: "home" },
    errorMessage: null,
    setupScript: null,
    createdAt: 0,
  };
}

describe("clearWorkspaceRuntimeState", () => {
  beforeEach(() => {
    useSessionSelectionStore.setState({
      pendingWorkspaces: upsertPendingWorkspaceEntry(
        EMPTY_PENDING_WORKSPACE_REGISTRY,
        buildEntry("attempt-a"),
      ),
      selectedLogicalWorkspaceId: "workspace-b",
      selectedWorkspaceId: "workspace-b",
      activeSessionId: null,
      workspaceArrivalEvent: null,
      workspaceSessionRecovery: null,
      hotPaintGate: null,
    });
  });

  it("preserves an unrelated live attempt when the selected workspace is cleared", () => {
    // Retiring / marking done workspace B while worktree attempt A is still in
    // flight: B's runtime state goes away, A's launch keeps running (PRO-230).
    const deps = {
      removeWorkspaceSlots: vi.fn(),
      clearSelection: useSessionSelectionStore.getState().clearSelection,
    };

    clearWorkspaceRuntimeState(deps, "workspace-b", { clearSelection: true });

    const state = useSessionSelectionStore.getState();
    expect(state.selectedWorkspaceId).toBeNull();
    expect(state.selectedLogicalWorkspaceId).toBeNull();
    expect(deps.removeWorkspaceSlots).toHaveBeenCalledWith("workspace-b");
    expect(state.pendingWorkspaces.attemptOrder).toEqual(["attempt-a"]);
    expect(state.pendingWorkspaces.entriesByAttemptId["attempt-a"])
      .toEqual(buildEntry("attempt-a"));
  });

  it("still wipes every attempt on an app-level selection reset", () => {
    // Negative control for the test above: the registry survives only because
    // the per-workspace caller opts in. Sign-out passes no options and must
    // still abort every launch.
    useSessionSelectionStore.getState().clearSelection();

    const state = useSessionSelectionStore.getState();
    expect(state.pendingWorkspaces.attemptOrder).toEqual([]);
    expect(state.pendingWorkspaces.entriesByAttemptId).toEqual({});
  });

  it("does not deselect when the cleared workspace is not the selected one", () => {
    const clearSelection = vi.fn();

    clearWorkspaceRuntimeState(
      { removeWorkspaceSlots: vi.fn(), clearSelection },
      "workspace-a",
      { clearSelection: true },
    );

    expect(clearSelection).not.toHaveBeenCalled();
    expect(useSessionSelectionStore.getState().selectedWorkspaceId).toBe("workspace-b");
  });
});
