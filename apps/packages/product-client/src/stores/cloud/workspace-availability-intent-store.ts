import { create } from "zustand";

/**
 * The active workspace-availability action (PR 5 Flows 2/3/5), owned by one
 * connected host (WorkspaceAvailabilityActionHost) mirroring the
 * cloud-repository-intent idiom. Each intent is a minimal serializable object
 * held only in memory: a cold restart leaves the store empty and nothing
 * resumes (the workspace menu is the recovery path).
 *
 * - open_on_mac: materialize a Cloud workspace's exact published HEAD locally.
 * - add_cloud_copy: create a managed-Cloud copy of a clean, published local
 *   workspace at its exact ref.
 * - unlink: association-only removal of this install's local materialization.
 * - relink: create a new generation and re-materialize/attach the local copy.
 * - recreate: same as relink but always re-materializes a fresh worktree.
 */
export type WorkspaceAvailabilityIntent =
  | { kind: "open_on_mac"; cloudWorkspaceId: string }
  | {
    kind: "add_cloud_copy";
    localWorkspaceId: string;
    gitOwner: string;
    gitRepoName: string;
  }
  | { kind: "unlink"; cloudWorkspaceId: string; materializationId: string }
  | { kind: "relink"; cloudWorkspaceId: string; mode: "relink" | "recreate" };

interface WorkspaceAvailabilityIntentState {
  activeIntent: WorkspaceAvailabilityIntent | null;
  begin: (intent: WorkspaceAvailabilityIntent) => void;
  clear: () => void;
}

export const useWorkspaceAvailabilityIntentStore = create<WorkspaceAvailabilityIntentState>(
  (set) => ({
    activeIntent: null,
    begin: (intent) => set({ activeIntent: intent }),
    clear: () => set({ activeIntent: null }),
  }),
);
