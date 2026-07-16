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
 * - reconcile: PR 6 — open the one reconciliation dialog to diagnose Git/
 *   materialization drift between the local and Cloud copies and offer the ONE
 *   safe next action (Push, Open Git panel, Recreate, Relink, Unlink, Retry).
 *   It NEVER resets/stashes/rebases/merges/force-pushes and never claims two
 *   different commits are linked. At least one of local/cloud ids is present.
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
  | { kind: "relink"; cloudWorkspaceId: string; mode: "relink" | "recreate" }
  | {
    kind: "reconcile";
    localWorkspaceId: string | null;
    cloudWorkspaceId: string | null;
    /** The linked materialization id, when an explicit link exists (enables the
     * Unlink recovery from the dialog). */
    materializationId: string | null;
    /** PR6-CONTINUATION-02: the ORIGINATING action this reconciliation was
     * entered from, serialized so the dialog can RESUME it after the user
     * resolves the blocking state (commit/push/re-check). `standalone` = entered
     * directly from the workspace menu, with no action to resume. Serializable
     * (no functions/refs) per PR 5's intent-store discipline. */
    continuation: WorkspaceReconcileContinuation;
  };

/** The action to resume after a successful reconciliation, carrying exactly the
 * inputs that action needs. A tagged union mirroring the availability intents so
 * the dialog can `begin()` the original intent again with its own inputs. */
export type WorkspaceReconcileContinuation =
  | { kind: "standalone" }
  | { kind: "add_cloud_copy"; localWorkspaceId: string; gitOwner: string; gitRepoName: string }
  | { kind: "open_on_mac"; cloudWorkspaceId: string }
  | { kind: "link_copies"; cloudWorkspaceId: string }
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
