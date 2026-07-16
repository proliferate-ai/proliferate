import type { PushResponse } from "@anyharness/sdk";
import {
  deriveWorkspaceGitRelation,
  type WorkspaceGitRelation,
  type WorkspaceGitSide,
} from "#product/lib/domain/workspaces/cloud/workspace-git-relation";

/**
 * PR 6 — pure "push-and-continue" orchestration for a clean, local-ahead
 * relation. Reuses the EXISTING AnyHarness push capability (the caller supplies
 * `push`, wired to `client.git.push` / `usePushGitMutation`), then re-reads
 * status and re-derives the relation. Pure so the "state changed between
 * preflight and push" cancellation and the "published is the confirmation
 * signal" rule are unit-testable away from the runtime.
 *
 * Binding safety rules (frozen spec Failure rules):
 *  - Re-evaluation wins: if the relation changes between preflight and the push,
 *    the stale action is CANCELLED (never a blind push against a moved tree).
 *  - `published` in PushResponse is the confirmation signal: a push whose
 *    response says `published: false` is NOT treated as success even if it
 *    resolved without throwing.
 *  - The remote HEAD is not client-verifiable, so "continue" is gated on a fresh
 *    LOCAL/Cloud re-read reaching `same_head` (or clean), never on a live remote
 *    probe. If it does not, the caller retries reading state before pushing.
 *  - No reset/stash/rebase/merge/force is ever issued — only `push`.
 */

export type PushAndContinueOutcome =
  | { status: "continued"; relation: WorkspaceGitRelation }
  | { status: "cancelled_stale"; relation: WorkspaceGitRelation; expected: WorkspaceGitRelation["kind"] }
  | { status: "not_published"; response: PushResponse }
  | { status: "still_ahead"; relation: WorkspaceGitRelation }
  | { status: "blocked"; relation: WorkspaceGitRelation };

export interface PushAndContinueCallbacks {
  /** Re-read the CURRENT local Git side (fresh status). */
  readLocalSide: () => Promise<WorkspaceGitSide>;
  /** The current Cloud side (last-known from the materialization row; the Cloud
   * runtime is not re-queried here). */
  readCloudSide: () => Promise<WorkspaceGitSide>;
  /** Push from the target via the existing AnyHarness push capability. */
  push: () => Promise<PushResponse>;
}

/**
 * Run push-and-continue for a `local_ahead`/`cloud_ahead` preflight. `expected`
 * is the relation kind the confirmation was shown for; if a fresh re-read no
 * longer matches, the action is cancelled (re-evaluation wins).
 *
 * The push targets `local` (this Mac). Cloud-side push is symmetric but the
 * Cloud runtime is not client-reachable for a live push in this PR, so the
 * caller only invokes this for the local direction; a `cloud_ahead` preflight
 * that reaches here is treated as a stale re-evaluation.
 */
export async function runPushAndContinue(
  expected: "local_ahead" | "cloud_ahead",
  callbacks: PushAndContinueCallbacks,
): Promise<PushAndContinueOutcome> {
  // Re-read both sides and re-derive BEFORE pushing (preflight validity).
  const preRelation = deriveWorkspaceGitRelation({
    local: await callbacks.readLocalSide(),
    cloud: await callbacks.readCloudSide(),
  });
  if (preRelation.kind === "same_head") {
    // Already converged (a concurrent push landed): nothing to do, continue.
    return { status: "continued", relation: preRelation };
  }
  if (preRelation.kind !== expected) {
    // The tree moved out from under the confirmation: cancel the stale action.
    return { status: "cancelled_stale", relation: preRelation, expected };
  }
  if (expected !== "local_ahead") {
    // Cloud push is not client-driven in this PR; a still-cloud_ahead relation
    // is manual (the caller shows the Cloud-authority guidance).
    return { status: "blocked", relation: preRelation };
  }

  const response = await callbacks.push();
  if (!response.published) {
    // Do not assume success from resolution alone — published is the signal.
    return { status: "not_published", response };
  }

  // Re-read after push and re-derive. Continue only when converged/clean.
  const postRelation = deriveWorkspaceGitRelation({
    local: await callbacks.readLocalSide(),
    cloud: await callbacks.readCloudSide(),
  });
  if (postRelation.kind === "same_head") {
    return { status: "continued", relation: postRelation };
  }
  if (postRelation.kind === "local_ahead") {
    // Still ahead after a published push (e.g. the Cloud side is a different
    // tracking ref): the caller retries reading state before pushing again.
    return { status: "still_ahead", relation: postRelation };
  }
  return { status: "blocked", relation: postRelation };
}
