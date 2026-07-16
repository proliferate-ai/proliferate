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
 * - link_copies: association-only adoption of an EXISTING local workspace that
 *   is proven to be the same exact ref as the Cloud copy (Flow 4). It cuts no
 *   worktree — the host verifies identity/branch/exact-HEAD and reports the
 *   existing local workspace. The chosen local candidate is resolved by the host
 *   (multiple candidates require explicit selection; never auto-pick).
 * - unlink: association-only removal of this install's local materialization.
 * - relink: reuse/adopt (Flow 5) — a new generation that re-materializes onto an
 *   existing clean checkout at the ref if one exists.
 * - recreate: like relink but always cuts a FRESH worktree (never adopts).
 */
export type WorkspaceAvailabilityIntent =
  | { kind: "open_on_mac"; cloudWorkspaceId: string }
  | {
    kind: "add_cloud_copy";
    localWorkspaceId: string;
    gitOwner: string;
    gitRepoName: string;
  }
  | { kind: "link_copies"; cloudWorkspaceId: string }
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
