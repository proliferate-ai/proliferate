import type { WorkspaceKind, WorkspaceMobilityArchive } from "@anyharness/sdk";
import type { StartWorkspaceMoveRequest, WorkspaceMoveResponse } from "@proliferate/cloud-sdk";
import {
  sourceFateForWorkspaceKind,
  type MoveDirection,
  type MovePhase,
} from "@/lib/domain/workspaces/move/move-model";

// Pure step sequencer for the local<->cloud workspace_move saga (pattern:
// run-workspace-publish-workflow.ts). Models spec section 2.3's step order plus the
// locked source-fate branching and failure semantics:
//   pre-cutover failure  -> unfreeze the source + fail the move
//   post-cutover failure -> cleanup retries only (no unfreeze/fail; caller resumes by
//                            re-invoking this function with `resume.phase: "cutover"`)
//
// Both v1 flows (local->cloud, spec section 2.3's first flow; the cloud->local mirror,
// its second) share this exact phase sequence -- `destination_ready` ->
// (exportSourceArchive + installArchive) -> `installed` -> cutover -> (source-fate
// cleanup) -> complete. What differs per `input.direction` is only *how much of that
// sequence this runner drives itself* vs. delegates into `deps`:
//   local->cloud: this runner freezes the source itself (`deps.freezeSource`) and, on
//     cutover, drives the source-fate cleanup dep directly.
//   cloud->local: the server freezes the cloud source as part of `deps.startMove`
//     itself (spec section 2.3 mirror step 2), so this runner skips `freezeSource`;
//     and there is no client-side source cleanup to drive on cutover -- the server's
//     `complete` call does it (spec section 2.3 mirror step 4) -- so the source-fate
//     dispatch is skipped too. `deps.exportSourceArchive`/`installArchive` are reused
//     as-is for both directions: the *hook* binds them to the right transport
//     (local AnyHarness vs. the server's export/install proxy + this desktop's own
//     local AnyHarness re-adopt-or-prepare install), not this pure sequencer.
//
// Reaches the world only through `deps` -- the caller (a workflow hook) resolves the
// concrete AnyHarness/cloud connections and binds them into these callbacks.

export interface WorkspaceMoveWorkflowDeps {
  startMove: (request: StartWorkspaceMoveRequest) => Promise<WorkspaceMoveResponse>;
  /** local->cloud only (see the direction comment above) -- freezes the local source
   *  workspace for handoff via its own AnyHarness engine. Not called for
   *  `cloud_to_local`, where the server freezes the cloud source inside `startMove`. */
  freezeSource: (moveId: string) => Promise<void>;
  /** Exports the source's session archive. local->cloud: the source's own local
   *  AnyHarness export call. cloud->local: the server's `/export` proxy call against
   *  the already-frozen cloud source. Either way this runner just needs an archive
   *  back to hand to `installArchive`. */
  exportSourceArchive: (moveId: string) => Promise<WorkspaceMobilityArchive>;
  /** Installs `archive` at the destination and returns the move at its new phase.
   *  local->cloud: forwards `archive` to the destination sandbox via the server's
   *  `/install` proxy. cloud->local: installs into the local destination via this
   *  desktop's own AnyHarness engine (prepare-or-readopt + install with
   *  `preserve_native_sessions`) and then acknowledges installation to the server --
   *  both steps are this dep's responsibility, not this pure sequencer's. */
  installArchive: (moveId: string, archive: WorkspaceMobilityArchive) => Promise<WorkspaceMoveResponse>;
  cutover: (moveId: string) => Promise<WorkspaceMoveResponse>;
  /** local->cloud only: managed-worktree source fate (sourceFateForWorkspaceKind ===
   *  "destroy"). Not called for `cloud_to_local` (see the direction comment above). */
  destroySource: (moveId: string) => Promise<void>;
  /** local->cloud only: plain local-directory source fate
   *  (sourceFateForWorkspaceKind === "mark_remote_owned"). Not called for
   *  `cloud_to_local` (see the direction comment above). */
  markSourceRemoteOwned: (moveId: string) => Promise<void>;
  /** Best-effort pre-cutover recovery: returns the source runtime to normal mode.
   *  Called for both directions -- the hook resolves whichever connection (local or,
   *  via the gateway, cloud) the move's own source workspace id routes to. */
  unfreezeSource: (moveId: string | null) => Promise<void>;
  completeMove: (moveId: string) => Promise<WorkspaceMoveResponse>;
  failMove: (moveId: string, failureCode: string, failureDetail: string | null) => Promise<void>;
  /** Optional progress callback -- fired after every phase transition the server
   *  confirms, so a progress modal can render Prepare/Transfer/Switch/Clean-up. */
  onPhaseChange?: (phase: MovePhase) => void;
}

export interface RunWorkspaceMoveWorkflowInput {
  start: StartWorkspaceMoveRequest;
  /** Which flow this run is driving (spec section 2.3) -- see the module comment above
   *  for exactly which steps this changes. */
  direction: MoveDirection;
  /** Drives source-fate cleanup after cutover (locked "Source fate after cutover"
   *  decision: managed worktrees are destroyed, plain local directories are only
   *  marked remote_owned). Required for `local_to_cloud` on every call, including
   *  resumes, since cleanup is recomputed fresh each time rather than persisted
   *  mid-saga; unused (the cloud source has no client-side cleanup) for
   *  `cloud_to_local`. */
  sourceWorkspaceKind?: WorkspaceKind;
  /** Present when resuming an existing non-terminal (or post-cutover, pre-complete)
   *  move instead of starting a fresh one. `phase` is the move's last known phase. */
  resume?: { moveId: string; phase: MovePhase };
}

export type WorkspaceMoveWorkflowResult =
  | { outcome: "completed"; moveId: string; destinationCloudWorkspaceId: string | null }
  | { outcome: "failed"; moveId: string | null; failureCode: string; failureDetail: string | null };

export async function runWorkspaceMoveWorkflow(
  input: RunWorkspaceMoveWorkflowInput,
  deps: WorkspaceMoveWorkflowDeps,
): Promise<WorkspaceMoveWorkflowResult> {
  let moveId = input.resume?.moveId ?? null;
  let phase: MovePhase | "not_started" = input.resume?.phase ?? "not_started";
  // Threaded back to the caller so a completed move can redirect the shell onto the new
  // cloud workspace (the source worktree may have just been destroyed). Populated from
  // the server's move rows, which carry it from the "destination_ready" transition on.
  let destinationCloudWorkspaceId: string | null = null;

  if (phase === "completed") {
    return { outcome: "completed", moveId: moveId!, destinationCloudWorkspaceId };
  }
  if (phase === "failed") {
    throw new Error("Cannot resume a failed move -- start a new move instead.");
  }

  try {
    // "started" is a transient server-side row state that normally flips to
    // "destination_ready" within the same start() call; a resume that observes it
    // (e.g. the server crashed mid-saga) just re-issues start, which is idempotent via
    // idempotencyKey.
    if (phase === "not_started" || phase === "started") {
      const move = await deps.startMove(input.start);
      moveId = move.id;
      phase = move.phase;
      destinationCloudWorkspaceId = destinationCloudWorkspaceIdFromMove(move) ?? destinationCloudWorkspaceId;
      deps.onPhaseChange?.(phase);
    }

    if (phase === "destination_ready") {
      if (input.direction === "local_to_cloud") {
        await deps.freezeSource(moveId!);
      }
      const archive = await deps.exportSourceArchive(moveId!);
      const move = await deps.installArchive(moveId!, archive);
      phase = move.phase;
      destinationCloudWorkspaceId = destinationCloudWorkspaceIdFromMove(move) ?? destinationCloudWorkspaceId;
      deps.onPhaseChange?.(phase);
    }

    if (phase === "installed") {
      const move = await deps.cutover(moveId!);
      phase = move.phase;
      destinationCloudWorkspaceId = destinationCloudWorkspaceIdFromMove(move) ?? destinationCloudWorkspaceId;
      deps.onPhaseChange?.(phase);
    }
  } catch (error) {
    const { code, detail } = describeFailure(error);
    await safely(() => deps.unfreezeSource(moveId));
    if (moveId) {
      await safely(() => deps.failMove(moveId!, code, detail));
    }
    return { outcome: "failed", moveId, failureCode: code, failureDetail: detail };
  }

  // Post-cutover: cleanup retries only. Errors here propagate as-is -- the move stays
  // in "cutover" phase server-side and the caller resumes by re-invoking with
  // `resume: { moveId, phase: "cutover" }`.
  if (phase === "cutover") {
    if (input.direction === "local_to_cloud") {
      if (!input.sourceWorkspaceKind) {
        throw new Error("sourceWorkspaceKind is required to clean up a local_to_cloud source.");
      }
      const fate = sourceFateForWorkspaceKind(input.sourceWorkspaceKind);
      if (fate === "destroy") {
        await deps.destroySource(moveId!);
      } else {
        await deps.markSourceRemoteOwned(moveId!);
      }
    }
    // cloud_to_local has no client-side source cleanup -- the server's `completeMove`
    // call retires the cloud source itself (spec section 2.3 mirror step 4).
    const move = await deps.completeMove(moveId!);
    phase = move.phase;
    destinationCloudWorkspaceId = destinationCloudWorkspaceIdFromMove(move) ?? destinationCloudWorkspaceId;
    deps.onPhaseChange?.(phase);
  }

  if (phase !== "completed") {
    throw new Error(`Unexpected terminal phase after cutover: ${phase}`);
  }
  return { outcome: "completed", moveId: moveId!, destinationCloudWorkspaceId };
}

/** The destination cloud workspace id the server recorded on a local->cloud move.
 *  Populated on the move row's `destinationRef` from the "destination_ready" transition
 *  onward (see workspace_moves/service.py); null before then or for non-cloud
 *  destinations. */
function destinationCloudWorkspaceIdFromMove(move: WorkspaceMoveResponse): string | null {
  if (move.destinationKind !== "cloud") return null;
  const id = (move.destinationRef as { cloudWorkspaceId?: unknown }).cloudWorkspaceId;
  return typeof id === "string" && id.length > 0 ? id : null;
}

async function safely(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch {
    // Best-effort: cleanup calls in the failure path must never mask the triggering error.
  }
}

function describeFailure(error: unknown): { code: string; detail: string | null } {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code.length > 0) {
      return { code, detail: errorMessage(error) };
    }
  }
  return { code: "move_workflow_error", detail: errorMessage(error) };
}

function errorMessage(error: unknown): string | null {
  return error instanceof Error ? error.message : String(error);
}
