import type { WorkspaceKind } from "@anyharness/sdk";
import type {
  WorkspaceMoveCanonicalSide,
  WorkspaceMovePhase,
  WorkspaceMoveRuntimeKind,
} from "@proliferate/cloud-sdk";

// Domain vocabulary for the workspace_move stack (specs/tbd/workspace-migration-v2.md
// section 2.2/2.3). Re-exported under desktop's own domain names so callers depend on
// this module rather than reaching into the cloud SDK's wire types directly.
export type MovePhase = WorkspaceMovePhase;
export type MoveCanonicalSide = WorkspaceMoveCanonicalSide;
export type MoveRuntimeKind = WorkspaceMoveRuntimeKind;

/** Phases in which the server saga is still actively driving the move. */
export const ACTIVE_MOVE_PHASES: ReadonlySet<MovePhase> = new Set([
  "started",
  "destination_ready",
  "installed",
]);

/** Phases that will never change again. */
export const TERMINAL_MOVE_PHASES: ReadonlySet<MovePhase> = new Set([
  "completed",
  "failed",
]);

export function isNonTerminalMovePhase(phase: MovePhase): boolean {
  return !TERMINAL_MOVE_PHASES.has(phase);
}

/** True once cutover has flipped canonical_side to the destination -- past this point,
 *  failure semantics change from "unfreeze + fail" to "cleanup retries only" (spec
 *  section 2.3, and the locked failure-semantics decision). */
export function isMovePostCutover(phase: MovePhase): boolean {
  return phase === "cutover" || phase === "completed";
}

/** One side of a move, resolved to the concrete runtime identity Desktop needs to drive
 *  it. Mirrors the cloud SDK's `WorkspaceMoveEndpointRef` wire shape (kept separate so
 *  domain code doesn't need to know which fields are meaningful for which `kind`). */
export type MoveRuntimeRef =
  | { kind: "local"; desktopInstallId: string; anyharnessWorkspaceId: string }
  | { kind: "cloud"; cloudWorkspaceId?: string | null; anyharnessWorkspaceId?: string | null }
  | { kind: "ssh"; targetId: string; anyharnessWorkspaceId: string };

export type MoveSourceFate = "destroy" | "mark_remote_owned";

/**
 * Source-fate policy after cutover (locked product decision, "Source fate after
 * cutover"): a managed worktree is destroyed; a workspace on the user's own plain
 * directory is only marked `remote_owned` -- files on disk are never touched.
 */
export function sourceFateForWorkspaceKind(workspaceKind: WorkspaceKind): MoveSourceFate {
  return workspaceKind === "worktree" ? "destroy" : "mark_remote_owned";
}

// ---- Readiness (see move-readiness.ts for the resolver) ----

export type MoveReadinessKind = "safe" | "push_required" | "prepare_required" | "blocked";

export interface MoveReadinessCopy {
  headline: string;
  body: string;
  primaryActionLabel: string;
}

export interface MoveReadinessSafe {
  kind: "safe";
  copy: MoveReadinessCopy;
}

export interface MoveReadinessPushRequired {
  kind: "push_required";
  copy: MoveReadinessCopy;
}

export interface MoveReadinessPrepareRequired {
  kind: "prepare_required";
  copy: MoveReadinessCopy;
  /** Whether the git-prep dialog should default "Include unstaged" to on. */
  includeUnstagedDefault: boolean;
}

export interface MoveReadinessBlocked {
  kind: "blocked";
  copy: MoveReadinessCopy;
  blockerCode: string;
}

export type MoveReadiness =
  | MoveReadinessSafe
  | MoveReadinessPushRequired
  | MoveReadinessPrepareRequired
  | MoveReadinessBlocked;
