import type { WorkspaceKind, WorkspaceMobilityRuntimeState } from "@anyharness/sdk";
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

/**
 * Recovers a stale move id from the source workspace's own runtime-state when this
 * app session's in-memory record of it (`workspace-move-store.ts`) has been lost --
 * e.g. Desktop was killed mid-move and restarted. Mirrors spec section 2.2's recovery
 * story: "a stale non-terminal row + engine preflight tells Desktop exactly what to
 * offer". The source is only ever frozen (`{mode: frozen_for_handoff, handoffOpId}`)
 * for the duration of its own in-flight move (step 3 of section 2.3's local->cloud
 * flow, cleared by cutover cleanup), so a frozen runtime-state's `handoffOpId` is
 * always that move's id.
 */
export function resolveHandoffMoveId(
  runtimeState: Pick<WorkspaceMobilityRuntimeState, "mode" | "handoffOpId"> | null | undefined,
): string | null {
  if (!runtimeState || runtimeState.mode !== "frozen_for_handoff") return null;
  return runtimeState.handoffOpId ?? null;
}

/** Where the shell should point once a local->cloud move settles successfully. Only
 *  redirects when the moved workspace is the one currently on screen -- a move kicked
 *  off for a different workspace (e.g. from the sidebar) must never yank the user away
 *  from what they're looking at. When the moved workspace *was* on screen the source may
 *  have just been destroyed (worktree source fate, sourceFateForWorkspaceKind), so we
 *  hand off to the freshly created cloud workspace, falling back to home only when its
 *  id is somehow unknown (e.g. resuming an already-completed move). */
export type PostMoveNavigation =
  | { kind: "select_cloud"; cloudWorkspaceId: string }
  | { kind: "home" }
  | { kind: "none" };

export function resolvePostMoveNavigation(input: {
  movedWorkspaceId: string;
  selectedWorkspaceId: string | null;
  destinationCloudWorkspaceId: string | null;
}): PostMoveNavigation {
  if (input.selectedWorkspaceId !== input.movedWorkspaceId) return { kind: "none" };
  if (input.destinationCloudWorkspaceId) {
    return { kind: "select_cloud", cloudWorkspaceId: input.destinationCloudWorkspaceId };
  }
  return { kind: "home" };
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
