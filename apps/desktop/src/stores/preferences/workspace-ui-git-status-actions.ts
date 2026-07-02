import {
  gitStatusSnapshotsMateriallyEqual,
  type PersistedWorkspaceGitStatusSnapshot,
} from "@/lib/domain/workspaces/git-status/workspace-git-status-model";
import type { WorkspaceUiGet, WorkspaceUiSet, WorkspaceUiState } from "@/stores/preferences/workspace-ui-store-types";

type WorkspaceUiGitStatusActions = Pick<
  WorkspaceUiState,
  | "recordWorkspaceGitStatusSnapshot"
  | "stampWorkspaceGitPrompt"
  | "pruneWorkspaceGitStatusSnapshots"
>;

export function createWorkspaceUiGitStatusActions(
  set: WorkspaceUiSet,
  get: WorkspaceUiGet,
): WorkspaceUiGitStatusActions {
  return {
    recordWorkspaceGitStatusSnapshot: (logicalWorkspaceId, snapshot) => {
      const current = get().gitStatusSnapshotByWorkspace;
      const existing = current[logicalWorkspaceId];
      if (
        existing
        && gitStatusSnapshotsMateriallyEqual(existing, snapshot)
        && existing.capturedAt === snapshot.capturedAt
      ) {
        return;
      }
      set({
        gitStatusSnapshotByWorkspace: {
          ...current,
          [logicalWorkspaceId]: snapshot,
        },
      });
    },

    stampWorkspaceGitPrompt: (logicalWorkspaceId, at) => {
      const current = get().gitStatusSnapshotByWorkspace;
      const existing = current[logicalWorkspaceId];
      const next: PersistedWorkspaceGitStatusSnapshot = existing
        ? { ...existing, lastPromptAt: at }
        : {
          branch: null,
          prState: null,
          prNumber: null,
          prUrl: null,
          checks: "none",
          reviewDecision: "none",
          capturedAt: at,
          lastPromptAt: at,
        };
      if (existing?.lastPromptAt === at) {
        return;
      }
      set({
        gitStatusSnapshotByWorkspace: {
          ...current,
          [logicalWorkspaceId]: next,
        },
      });
    },

    pruneWorkspaceGitStatusSnapshots: (liveLogicalWorkspaceIds) => {
      const current = get().gitStatusSnapshotByWorkspace;
      const live = new Set(liveLogicalWorkspaceIds);
      const staleIds = Object.keys(current).filter((id) => !live.has(id));
      if (staleIds.length === 0) {
        return;
      }
      const next = { ...current };
      for (const id of staleIds) {
        delete next[id];
      }
      set({ gitStatusSnapshotByWorkspace: next });
    },
  };
}
