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
 *  - Continue is gated on a fresh LOCAL+Cloud re-read reaching `same_head`, using
 *    the LIVE Cloud status the caller supplies (PR6-CLOUD-TRUTH-01) — never a
 *    fabricated cloud state. If it does not converge, the caller retries.
 *  - No reset/stash/rebase/merge/force is ever issued — only `push`.
 *  - Both directions execute: `local_ahead` pushes from this Mac, `cloud_ahead`
 *    pushes from the Cloud runtime (the caller wires `push` to the right runtime;
 *    PR6-CLOUD-PUSH-03).
 */

export type PushAndContinueOutcome =
  | { status: "continued"; relation: WorkspaceGitRelation }
  | { status: "cancelled_stale"; relation: WorkspaceGitRelation; expected: WorkspaceGitRelation["kind"] }
  | { status: "not_published"; response: PushResponse }
  | { status: "still_ahead"; relation: WorkspaceGitRelation }
  | { status: "blocked"; relation: WorkspaceGitRelation };

export interface PushAndContinueCallbacks {
  /** Re-read the CURRENT local Git side (fresh live status). */
  readLocalSide: () => Promise<WorkspaceGitSide>;
  /** Re-read the CURRENT Cloud Git side (fresh live status where reachable). */
  readCloudSide: () => Promise<WorkspaceGitSide>;
  /** Push from the ahead target via the existing AnyHarness push capability
   * (wired by the caller to the correct — local or Cloud — runtime). */
  push: () => Promise<PushResponse>;
}

/**
 * Run push-and-continue for a `local_ahead`/`cloud_ahead` preflight. `expected`
 * is the relation kind the confirmation was shown for; if a fresh re-read no
 * longer matches, the action is cancelled (re-evaluation wins). Both directions
 * execute — the caller wires `push` to this Mac's runtime (local) or the Cloud
 * workspace's runtime (cloud).
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
    // The tree moved out from under the confirmation (incl. the Cloud state
    // becoming unverifiable): cancel the stale action, re-evaluation wins.
    return { status: "cancelled_stale", relation: preRelation, expected };
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
  if (postRelation.kind === expected) {
    // Still ahead in the same direction after a published push: the caller
    // retries reading state before pushing again.
    return { status: "still_ahead", relation: postRelation };
  }
  return { status: "blocked", relation: postRelation };
}
