import type { WorkspaceKind, WorkspaceMobilityArchive } from "@anyharness/sdk";
import type { StartWorkspaceMoveRequest, WorkspaceMoveResponse } from "@proliferate/cloud-sdk";
import {
  sourceFateForWorkspaceKind,
  type MovePhase,
} from "@/lib/domain/workspaces/move/move-model";

// Pure step sequencer for the local<->cloud workspace_move saga (pattern:
// run-workspace-publish-workflow.ts). Models spec section 2.3's step order plus the
// locked source-fate branching and failure semantics:
//   pre-cutover failure  -> unfreeze the source + fail the move
//   post-cutover failure -> cleanup retries only (no unfreeze/fail; caller resumes by
//                            re-invoking this function with `resume.phase: "cutover"`)
//
// Reaches the world only through `deps` -- the caller (a workflow hook) resolves the
// concrete AnyHarness/cloud connections and binds them into these callbacks.

export interface WorkspaceMoveWorkflowDeps {
  startMove: (request: StartWorkspaceMoveRequest) => Promise<WorkspaceMoveResponse>;
  freezeSource: (moveId: string) => Promise<void>;
  exportSourceArchive: (moveId: string) => Promise<WorkspaceMobilityArchive>;
  installArchive: (moveId: string, archive: WorkspaceMobilityArchive) => Promise<WorkspaceMoveResponse>;
  cutover: (moveId: string) => Promise<WorkspaceMoveResponse>;
  /** Managed-worktree source fate (sourceFateForWorkspaceKind === "destroy"). */
  destroySource: (moveId: string) => Promise<void>;
  /** Plain local-directory source fate (sourceFateForWorkspaceKind === "mark_remote_owned"). */
  markSourceRemoteOwned: (moveId: string) => Promise<void>;
  /** Best-effort pre-cutover recovery: returns the source runtime to normal mode. */
  unfreezeSource: (moveId: string | null) => Promise<void>;
  completeMove: (moveId: string) => Promise<WorkspaceMoveResponse>;
  failMove: (moveId: string, failureCode: string, failureDetail: string | null) => Promise<void>;
  /** Optional progress callback -- fired after every phase transition the server
   *  confirms, so a progress modal can render Prepare/Transfer/Switch/Clean-up. */
  onPhaseChange?: (phase: MovePhase) => void;
}

export interface RunWorkspaceMoveWorkflowInput {
  start: StartWorkspaceMoveRequest;
  /** Drives source-fate cleanup after cutover (locked "Source fate after cutover"
   *  decision: managed worktrees are destroyed, plain local directories are only
   *  marked remote_owned). Required on every call, including resumes, since cleanup
   *  is recomputed fresh each time rather than persisted mid-saga. */
  sourceWorkspaceKind: WorkspaceKind;
  /** Present when resuming an existing non-terminal (or post-cutover, pre-complete)
   *  move instead of starting a fresh one. `phase` is the move's last known phase. */
  resume?: { moveId: string; phase: MovePhase };
}

export type WorkspaceMoveWorkflowResult =
  | { outcome: "completed"; moveId: string }
  | { outcome: "failed"; moveId: string | null; failureCode: string; failureDetail: string | null };

export async function runWorkspaceMoveWorkflow(
  input: RunWorkspaceMoveWorkflowInput,
  deps: WorkspaceMoveWorkflowDeps,
): Promise<WorkspaceMoveWorkflowResult> {
  let moveId = input.resume?.moveId ?? null;
  let phase: MovePhase | "not_started" = input.resume?.phase ?? "not_started";

  if (phase === "completed") {
    return { outcome: "completed", moveId: moveId! };
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
      deps.onPhaseChange?.(phase);
    }

    if (phase === "destination_ready") {
      await deps.freezeSource(moveId!);
      const archive = await deps.exportSourceArchive(moveId!);
      const move = await deps.installArchive(moveId!, archive);
      phase = move.phase;
      deps.onPhaseChange?.(phase);
    }

    if (phase === "installed") {
      const move = await deps.cutover(moveId!);
      phase = move.phase;
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
    const fate = sourceFateForWorkspaceKind(input.sourceWorkspaceKind);
    if (fate === "destroy") {
      await deps.destroySource(moveId!);
    } else {
      await deps.markSourceRemoteOwned(moveId!);
    }
    const move = await deps.completeMove(moveId!);
    phase = move.phase;
    deps.onPhaseChange?.(phase);
  }

  if (phase !== "completed") {
    throw new Error(`Unexpected terminal phase after cutover: ${phase}`);
  }
  return { outcome: "completed", moveId: moveId! };
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
