import type { WorkspaceGitRelation } from "#product/lib/domain/workspaces/cloud/workspace-git-relation";

/**
 * PR 6 — the pure action policy that maps a cross-target Git relation to the ONE
 * safe next action (or a truthful, non-actionable blocker). Pure and DOM-free so
 * the exhaustive relation → action matrix is unit-testable.
 *
 * Concrete verbs only — Push, Commit, Open Git panel, Recreate, Relink, Unlink,
 * Retry — never a generic "Sync". Absolute safety rails: no reset/stash/rebase/
 * merge/force is EVER an offered action; diverged/dirty/conflict/detached/
 * in-operation states require manual resolution on a selected target; a Cloud
 * copy at a different clean head is `cloud_ahead` (needs Cloud authority), never
 * silently adopted.
 */

/** The action verb the reconciliation dialog offers. `none` = an informational
 * blocker with no in-product action (the user resolves it in Git themselves). */
export type WorkspaceGitReconciliationVerb =
  | "link"
  | "push-local"
  | "push-cloud"
  | "open-git-panel"
  | "recreate"
  | "relink"
  | "unlink"
  | "retry"
  | "add-cloud-copy"
  | "open-on-mac"
  | "none";

export interface WorkspaceGitReconciliationAction {
  verb: WorkspaceGitReconciliationVerb;
  /** The confirmation CTA label (concrete verb). */
  label: string;
  /** One-line explanation of what this action does and its safety boundary. */
  detail: string;
  /** Whether this verb mutates git state and therefore requires explicit
   * confirmation before running (push/recreate). */
  requiresConfirmation: boolean;
  /** Which target the action operates on, when target-scoped. */
  target?: "local" | "cloud";
}

export interface WorkspaceGitReconciliationPlan {
  relation: WorkspaceGitRelation;
  /** A short truthful title for the state. */
  title: string;
  /** The one safe next action. */
  action: WorkspaceGitReconciliationAction;
  /** What stays unchanged if the user cancels (never destructive). */
  cancelPreserves: string;
  /** True when the two copies are provably the exact same commit (safe to
   * link/open immediately). Mirrors relation.kind === "same_head". */
  linkable: boolean;
}

const NO_DESTRUCTIVE_NOTE =
  "Nothing is reset, merged, rebased, or deleted.";

/**
 * Resolve the single safe action for a relation. The blocked/manual states all
 * resolve to a non-mutating verb (Open Git panel or an informational blocker);
 * only same-head link and clean-ahead push are actionable mutations, and push
 * always requires explicit confirmation.
 */
export function resolveWorkspaceGitReconciliation(
  relation: WorkspaceGitRelation,
): WorkspaceGitReconciliationPlan {
  switch (relation.kind) {
    case "same_head":
      return {
        relation,
        title: "Copies are at the same commit",
        action: {
          verb: "link",
          label: "Link and continue",
          detail: "Both copies are the exact same commit, so they can be linked without changing "
            + "either checkout.",
          requiresConfirmation: false,
        },
        cancelPreserves: "Both checkouts stay exactly as they are.",
        linkable: true,
      };
    case "local_ahead":
      return {
        relation,
        title: "This Mac is ahead",
        action: {
          verb: "push-local",
          label: "Push from this Mac and continue…",
          detail: `Push ${commitsLabel(relation.commits)} from this Mac to the remote, then re-read `
            + "state and continue. " + NO_DESTRUCTIVE_NOTE,
          requiresConfirmation: true,
          target: "local",
        },
        cancelPreserves: "No commits are pushed; both checkouts stay as they are.",
        linkable: false,
      };
    case "cloud_ahead":
      return {
        relation,
        title: "Cloud is ahead",
        action: {
          verb: "push-cloud",
          label: "Push from Cloud and continue…",
          detail: `Push ${commitsLabel(relation.commits)} from the Cloud copy to the remote, then `
            + "re-read state and continue. " + NO_DESTRUCTIVE_NOTE,
          requiresConfirmation: true,
          target: "cloud",
        },
        cancelPreserves: "No commits are pushed; both checkouts stay as they are.",
        linkable: false,
      };
    case "local_dirty":
      return manualPlan(relation, {
        title: "This Mac has uncommitted changes",
        detail: "This Mac has uncommitted changes. Commit or set them aside in the Git panel, "
          + "then try again. " + NO_DESTRUCTIVE_NOTE,
        target: "local",
        canOpenGitPanel: true,
      });
    case "cloud_dirty":
      return manualPlan(relation, {
        title: "Cloud has uncommitted changes",
        detail: "The Cloud copy has uncommitted changes. Commit or set them aside on Cloud, then "
          + "try again. " + NO_DESTRUCTIVE_NOTE,
        target: "cloud",
        canOpenGitPanel: false,
      });
    case "conflicted":
      return manualPlan(relation, {
        title: "Unresolved merge conflicts",
        detail: `The ${targetName(relation.target)} copy has unresolved merge conflicts. Resolve `
          + "them, then try again. " + NO_DESTRUCTIVE_NOTE,
        target: relation.target,
        canOpenGitPanel: relation.target === "local",
      });
    case "git_operation_in_progress":
      return manualPlan(relation, {
        title: "A Git operation is in progress",
        detail: `The ${targetName(relation.target)} copy is mid-operation (merge/rebase/…). Finish `
          + "or abort it in Git, then try again. " + NO_DESTRUCTIVE_NOTE,
        target: relation.target,
        canOpenGitPanel: relation.target === "local",
      });
    case "detached":
      return manualPlan(relation, {
        title: "Detached HEAD",
        detail: `The ${targetName(relation.target)} copy is on a detached HEAD. Check out a branch, `
          + "then try again. " + NO_DESTRUCTIVE_NOTE,
        target: relation.target,
        canOpenGitPanel: relation.target === "local",
      });
    case "behind":
      return manualPlan(relation, {
        title: "Behind the remote",
        detail: `The ${targetName(relation.target)} copy is behind its remote branch. Update it `
          + "manually in Git — the product will not pull or rebase for you. " + NO_DESTRUCTIVE_NOTE,
        target: relation.target,
        canOpenGitPanel: relation.target === "local",
      });
    case "diverged":
      return manualPlan(relation, {
        title: "Copies have diverged",
        detail: "This Mac and Cloud have different commits that are not a simple ahead/behind. "
          + "Resolve the divergence yourself on one target — the product will not choose a reset or "
          + "rebase direction. " + NO_DESTRUCTIVE_NOTE,
        canOpenGitPanel: true,
      });
    case "missing":
      // Local missing is the Recreate/Relink/Unlink recovery (built on PR 5's
      // localMaterializationNeedsRepair branch). Cloud missing surfaces a retry.
      if (relation.target === "local") {
        return {
          relation,
          title: "This Mac's copy is missing",
          action: {
            verb: "recreate",
            label: "Recreate on this Mac…",
            detail: "The local checkout for this workspace is gone. Recreate it on this Mac, relink "
              + "an existing copy, or unlink this Mac. " + NO_DESTRUCTIVE_NOTE,
            requiresConfirmation: true,
            target: "local",
          },
          cancelPreserves: "The Cloud copy, repository, and chat history are untouched.",
          linkable: false,
        };
      }
      return retryPlan(relation, {
        title: "The Cloud copy is missing",
        detail: "The Cloud copy is not currently available. Retry once it is back; the association "
          + "is preserved. " + NO_DESTRUCTIVE_NOTE,
        target: "cloud",
      });
    case "unreachable":
      return retryPlan(relation, {
        title: `The ${targetName(relation.target)} copy is unreachable`,
        detail: `The ${targetName(relation.target)} copy can't be reached right now. Retry when it `
          + "is back; the association is preserved. " + NO_DESTRUCTIVE_NOTE,
        target: relation.target,
      });
    case "cloud_state_unverified":
      // PR6-CLOUD-TRUTH-01: the Cloud copy's live state could not be read, so we
      // will NOT claim it is safe/same. Manual re-check (Retry) only; the head we
      // show is last-reported, not live.
      return retryPlan(relation, {
        title: "Cloud state can't be verified",
        detail: "The Cloud copy's live Git state couldn't be read, so its cleanliness can't be "
          + "confirmed. Its commit shown here is last-reported, not live. Retry to re-check; nothing "
          + "is assumed safe. " + NO_DESTRUCTIVE_NOTE,
        target: "cloud",
      });
    case "no_cloud_copy":
      // Not a failure: there simply is no Cloud copy yet. The action is to add one
      // (this is the resume target for a blocked Add Cloud copy).
      return {
        relation,
        title: "No Cloud copy yet",
        action: {
          verb: "add-cloud-copy",
          label: "Add Cloud copy…",
          detail: "This workspace has no Cloud copy yet. Once this Mac is clean and published, add a "
            + "managed Cloud copy at its exact commit. " + NO_DESTRUCTIVE_NOTE,
          requiresConfirmation: true,
          target: "cloud",
        },
        cancelPreserves: "This Mac's checkout stays exactly as it is; no Cloud copy is created.",
        linkable: false,
      };
    case "no_local_copy":
      return {
        relation,
        title: "No copy on this Mac yet",
        action: {
          verb: "open-on-mac",
          label: "Open on this Mac…",
          detail: "This workspace has no local copy on this Mac yet. Open one at the Cloud copy's "
            + "exact published commit. " + NO_DESTRUCTIVE_NOTE,
          requiresConfirmation: true,
          target: "local",
        },
        cancelPreserves: "The Cloud copy stays exactly as it is; nothing is created on this Mac.",
        linkable: false,
      };
    case "unknown":
      return retryPlan(relation, {
        title: "Can't compare the copies yet",
        detail: relation.reason + " Retry once status is available. " + NO_DESTRUCTIVE_NOTE,
      });
  }
}

function manualPlan(
  relation: WorkspaceGitRelation,
  args: {
    title: string;
    detail: string;
    target?: "local" | "cloud";
    canOpenGitPanel: boolean;
  },
): WorkspaceGitReconciliationPlan {
  return {
    relation,
    title: args.title,
    action: args.canOpenGitPanel
      ? {
        verb: "open-git-panel",
        label: "Open Git panel",
        detail: args.detail,
        requiresConfirmation: false,
        target: args.target,
      }
      : {
        verb: "none",
        label: "OK",
        detail: args.detail,
        requiresConfirmation: false,
        target: args.target,
      },
    cancelPreserves: "Both checkouts stay exactly as they are.",
    linkable: false,
  };
}

function retryPlan(
  relation: WorkspaceGitRelation,
  args: { title: string; detail: string; target?: "local" | "cloud" },
): WorkspaceGitReconciliationPlan {
  return {
    relation,
    title: args.title,
    action: {
      verb: "retry",
      label: "Retry",
      detail: args.detail,
      requiresConfirmation: false,
      target: args.target,
    },
    cancelPreserves: "The association and both copies are preserved.",
    linkable: false,
  };
}

function targetName(target: "local" | "cloud"): string {
  return target === "local" ? "This Mac" : "Cloud";
}

function commitsLabel(commits: number): string {
  return commits === 1 ? "1 commit" : `${commits} commits`;
}
