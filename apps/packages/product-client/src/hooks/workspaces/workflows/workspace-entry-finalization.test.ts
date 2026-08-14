import { describe, expect, it, vi } from "vitest";
import {
  buildPendingWorkspaceUiKey,
  buildSubmittingPendingWorkspaceEntry,
  type PendingWorkspaceEntry,
} from "#product/lib/domain/workspaces/creation/pending-entry";
import {
  completePendingWorkspaceCreationInBackground,
  shouldFinalizePendingWorkspaceSelection,
} from "#product/hooks/workspaces/workflows/workspace-entry-finalization";

function submittingEntry(attemptId = "attempt-1"): PendingWorkspaceEntry {
  return buildSubmittingPendingWorkspaceEntry({
    attemptId,
    selectedWorkspaceId: null,
    source: "worktree-created",
    displayName: "snipe",
    request: {
      kind: "worktree",
      input: { repoRootId: "repo-1" },
    },
  });
}

function selectionState(overrides: {
  pendingWorkspaceEntry?: PendingWorkspaceEntry | null;
  selectedLogicalWorkspaceId?: string | null;
}) {
  return () => ({
    activeSessionId: null,
    pendingWorkspaceEntry: overrides.pendingWorkspaceEntry ?? null,
    selectedLogicalWorkspaceId: overrides.selectedLogicalWorkspaceId ?? null,
  });
}

describe("shouldFinalizePendingWorkspaceSelection", () => {
  it("finalizes while the attempt's pending shell is still selected", () => {
    const entry = submittingEntry();
    expect(shouldFinalizePendingWorkspaceSelection(entry, {
      getSelectionState: selectionState({
        pendingWorkspaceEntry: entry,
        selectedLogicalWorkspaceId: buildPendingWorkspaceUiKey(entry),
      }),
    })).toBe(true);
  });

  it("routes to background when the user selected another workspace", () => {
    const entry = submittingEntry();
    expect(shouldFinalizePendingWorkspaceSelection(entry, {
      getSelectionState: selectionState({
        pendingWorkspaceEntry: entry,
        selectedLogicalWorkspaceId: "workspace-2",
      }),
    })).toBe(false);
  });

  it("routes to background when another attempt replaced the entry", () => {
    const entry = submittingEntry();
    const replacement = submittingEntry("attempt-2");
    expect(shouldFinalizePendingWorkspaceSelection(entry, {
      getSelectionState: selectionState({
        pendingWorkspaceEntry: replacement,
        selectedLogicalWorkspaceId: buildPendingWorkspaceUiKey(replacement),
      }),
    })).toBe(false);
  });
});

describe("completePendingWorkspaceCreationInBackground", () => {
  it("materializes without activation, stamps creation-time recency, and clears its own entry", () => {
    const entry = submittingEntry();
    const materializePendingWorkspaceSessions = vi.fn();
    const setPendingWorkspaceEntry = vi.fn();
    const trackWorkspaceInteraction = vi.fn();

    const result = completePendingWorkspaceCreationInBackground({
      entry,
      workspaceId: "workspace-9",
      projectedSessionId: "client-session:abc",
    }, {
      getSelectionState: selectionState({ pendingWorkspaceEntry: entry }),
      materializePendingWorkspaceSessions,
      setPendingWorkspaceEntry,
      trackWorkspaceInteraction,
    });

    expect(result).toEqual({
      workspaceId: "workspace-9",
      projectedSessionId: "client-session:abc",
    });
    expect(materializePendingWorkspaceSessions).toHaveBeenCalledWith(entry, "workspace-9", {
      eventPrefix: "workspace.entry.background",
      skipSessionActivation: true,
    });
    // The real row inherits the pending row's sidebar slot: recency is the
    // entry's creation instant, not the completion instant.
    expect(trackWorkspaceInteraction).toHaveBeenCalledWith(
      "workspace-9",
      new Date(entry.createdAt).toISOString(),
    );
    expect(setPendingWorkspaceEntry).toHaveBeenCalledWith(null);
  });

  it("leaves a replacement attempt's entry untouched", () => {
    const entry = submittingEntry();
    const replacement = submittingEntry("attempt-2");
    const setPendingWorkspaceEntry = vi.fn();

    completePendingWorkspaceCreationInBackground({
      entry,
      workspaceId: "workspace-9",
      projectedSessionId: null,
    }, {
      getSelectionState: selectionState({ pendingWorkspaceEntry: replacement }),
      materializePendingWorkspaceSessions: vi.fn(),
      setPendingWorkspaceEntry,
      trackWorkspaceInteraction: vi.fn(),
    });

    expect(setPendingWorkspaceEntry).not.toHaveBeenCalled();
  });
});
