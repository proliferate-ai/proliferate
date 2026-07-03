import type { GitStatusSnapshot, WorkspaceMobilityPreflightResponse } from "@anyharness/sdk";
import type { WorkspaceMoveResponse } from "@proliferate/cloud-sdk";
import {
  isNonTerminalMovePhase,
  type MoveDirection,
  type MoveReadiness,
  type MoveReadinessCopy,
} from "@/lib/domain/workspaces/move/move-model";

/**
 * AnyHarness mobility preflight blocker codes (anyharness-lib
 * domains/mobility/service.rs::preflight_workspace) that must strictly block a move --
 * the locked "Strict blockers" list: active turn / pending interaction. Everything else
 * the engine can return (workspace_dirty, review_active, unsupported_session, ...) is
 * either handled via the git-status fields below (dirty -> prepare_required) or is
 * out of scope for this pure gate in v1 and stays informational on the raw preflight
 * response for the UI to surface separately.
 */
const STRICT_PREFLIGHT_BLOCKER_CODES = new Set([
  "session_running",
  "session_awaiting_interaction",
  "pending_prompt",
]);

const BLOCKER_COPY: Record<string, MoveReadinessCopy> = {
  active_move: {
    headline: "A move is already in progress",
    body: "Resume or abandon the existing move before starting a new one.",
    primaryActionLabel: "View move",
  },
  status_loading: {
    headline: "Checking workspace status…",
    body: "Hold on while we check whether this workspace is ready to move.",
    primaryActionLabel: "Checking…",
  },
  session_running: {
    headline: "A session is running",
    body: "Wait for the active turn to finish before moving this workspace.",
    primaryActionLabel: "Got it",
  },
  session_awaiting_interaction: {
    headline: "A session needs your input",
    body: "Answer the pending prompt before moving this workspace.",
    primaryActionLabel: "Got it",
  },
  pending_prompt: {
    headline: "A session needs your input",
    body: "Answer the pending prompt before moving this workspace.",
    primaryActionLabel: "Got it",
  },
  workspace_detached: {
    headline: "Checked out at a detached commit",
    body: "Switch to a branch before moving this workspace.",
    primaryActionLabel: "Got it",
  },
  workspace_conflicted: {
    headline: "Resolve conflicts first",
    body: "This workspace has unresolved merge conflicts.",
    primaryActionLabel: "Got it",
  },
  git_operation_in_progress: {
    headline: "A Git operation is in progress",
    body: "Finish or abort the current merge, rebase, or cherry-pick before moving.",
    primaryActionLabel: "Got it",
  },
  behind_upstream: {
    headline: "Sync this branch first",
    body: "Pull the latest changes before moving this workspace.",
    primaryActionLabel: "Open Git tools",
  },
  local_repo_not_found: {
    headline: "This repository isn't on this Mac yet",
    body: "Clone this repository locally before moving this workspace here.",
    primaryActionLabel: "Got it",
  },
  local_branch_already_checked_out: {
    headline: "This branch is already open locally",
    body: "This branch is already checked out in another local workspace. Move or retire that workspace first.",
    primaryActionLabel: "Got it",
  },
};

/** Only the safe-state primary action names the destination -- push/prepare's labels
 *  ("Push and move", "Commit, push, and move") already read fine for either
 *  direction, so only this one varies (locked "Same dialog, direction-aware copy"
 *  decision, spec section 2.6). */
const SAFE_COPY_BY_DIRECTION: Record<MoveDirection, MoveReadinessCopy> = {
  local_to_cloud: {
    headline: "Ready to move",
    body: "This workspace is clean and published — it can move right away.",
    primaryActionLabel: "Move to cloud",
  },
  cloud_to_local: {
    headline: "Ready to move",
    body: "This workspace is clean and published — it can move right away.",
    primaryActionLabel: "Move to this Mac",
  },
};

const PUSH_REQUIRED_COPY: MoveReadinessCopy = {
  headline: "Push before moving",
  body: "This branch has local commits that haven't been pushed yet.",
  primaryActionLabel: "Push and move",
};

const PREPARE_REQUIRED_COPY: MoveReadinessCopy = {
  headline: "Commit and push before moving",
  body: "This workspace has uncommitted changes. Commit and push them, then move.",
  primaryActionLabel: "Commit, push, and move",
};

/**
 * Destination-side readiness, checked before source freeze (durability plan's
 * "Destination not at requested commit" case). Always `null` for a fresh local->cloud
 * move -- the server materializes the destination as part of `start`, so there is
 * nothing to check yet. Meaningful for the cloud->local mirror (PR D) when a prior
 * round-trip's original worktree needs to be re-adopted.
 */
export interface MoveDestinationState {
  ready: boolean;
  blockerCode: string;
  blockerMessage: string;
}

export interface MoveReadinessInput {
  gitStatus: GitStatusSnapshot | null;
  sourcePreflight: WorkspaceMobilityPreflightResponse | null;
  destinationState: MoveDestinationState | null;
  /** The identity's current non-terminal move, if any (spec section 2.2's partial-unique
   *  "one non-terminal move per (user, repo, branch)" invariant, mirrored client-side). */
  activeMove: WorkspaceMoveResponse | null;
  /** Which flow the safe-state copy should name (spec section 2.6, "Same dialog,
   *  direction-aware copy"). Defaults to `local_to_cloud` so every pre-PR-D call site
   *  keeps its existing "Move to cloud" copy unchanged. */
  direction?: MoveDirection;
}

/**
 * Pure resolver: {gitStatus, sourcePreflight, destinationState, activeMove} -> exactly
 * one of safe | push_required | prepare_required | blocked, with copy + primary action +
 * blocker code (locked "Readiness" decision). Strict blockers: active turn / pending
 * interaction (from preflight), detached head, conflicts, git op in progress, behind>0,
 * active non-terminal move.
 */
export function resolveMoveReadiness(input: MoveReadinessInput): MoveReadiness {
  if (input.activeMove && isNonTerminalMovePhase(input.activeMove.phase)) {
    return blocked("active_move");
  }

  if (!input.gitStatus || !input.sourcePreflight) {
    return blocked("status_loading");
  }

  const strictPreflightBlocker = input.sourcePreflight.blockers?.find((blocker) =>
    STRICT_PREFLIGHT_BLOCKER_CODES.has(blocker.code));
  if (strictPreflightBlocker) {
    return blocked(strictPreflightBlocker.code, strictPreflightBlocker.message);
  }

  if (input.gitStatus.detached) {
    return blocked("workspace_detached");
  }
  if (input.gitStatus.conflicted) {
    return blocked("workspace_conflicted");
  }
  if (input.gitStatus.operation !== "none") {
    return blocked("git_operation_in_progress");
  }
  if (input.gitStatus.behind > 0) {
    return blocked("behind_upstream");
  }

  if (input.destinationState && !input.destinationState.ready) {
    return blocked(input.destinationState.blockerCode, input.destinationState.blockerMessage);
  }

  if (!input.gitStatus.clean) {
    return {
      kind: "prepare_required",
      copy: PREPARE_REQUIRED_COPY,
      includeUnstagedDefault: true,
    };
  }

  const needsPush = input.gitStatus.ahead > 0 || !input.gitStatus.upstreamBranch;
  if (needsPush) {
    return { kind: "push_required", copy: PUSH_REQUIRED_COPY };
  }

  return { kind: "safe", copy: SAFE_COPY_BY_DIRECTION[input.direction ?? "local_to_cloud"] };
}

function blocked(code: string, message?: string): MoveReadiness {
  const knownCopy = BLOCKER_COPY[code];
  const copy: MoveReadinessCopy = knownCopy ?? {
    headline: "Can't move this workspace yet",
    body: message ?? "This workspace can't be moved right now.",
    primaryActionLabel: "Got it",
  };
  return { kind: "blocked", copy, blockerCode: code };
}
