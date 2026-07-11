/**
 * Pure logic for the desktop workflow executor (track 2a; lifts L15).
 *
 * A due LOCAL schedule trigger fires a `claimable` run on the server (nothing on
 * the server delivers it). The desktop claims it (10s poll), mints a fresh
 * worktree, and delivers the resolved plan to its OWN local runtime through the
 * runtime's plan-delivery wire (`POST /v1/workflow-runs`) — the exact same wire a
 * manual local run uses.
 *
 * THE TRAP (mental-model §11): the *automations* executor opens sessions via the
 * `@anyharness/sdk` (`client.sessions.create` / `promptText`), which bypasses the
 * Rust forced-bypass exec policy — an unattended run would then stall on a
 * permission prompt. The workflow executor MUST NOT do that. It hands the plan to
 * the runtime, which opens sessions itself under `ensure_session` (forced bypass).
 * This module is the pure seam that guarantees it: {@link buildWorkflowRunDeliveryPayload}
 * produces ONLY the plan-delivery body (`{ plan, workspaceId }`) — there is no
 * session-creation surface here, so a regression that re-routed delivery through
 * the SDK session path would have to abandon this payload and fail its test.
 *
 * This module is pure (no I/O, no React) so the claim→deliver mapping, heartbeat
 * cadence, worktree-plan derivation, and relay re-attach predicate are unit-tested
 * directly.
 */

/** Cadence mirrors the automations claim loop so the server claim TTL (90s)
 * comfortably covers a missed heartbeat. */
export const WORKFLOW_LOCAL_EXECUTOR_POLL_MS = 10_000;
export const WORKFLOW_LOCAL_EXECUTOR_HEARTBEAT_MS = 30_000;
/** Two consecutive heartbeat failures = the claim is presumed lost (the server
 * may already have reclaimed it); the executor stops touching the run. */
export const WORKFLOW_LOCAL_HEARTBEAT_MAX_ERRORS = 2;

/**
 * Grace window the executor keeps heartbeating AFTER the plan is delivered, before
 * releasing the claim (finding 3). Delivery hands the plan to the runtime, but the
 * relay hasn't yet reported `running`; a crash in that instant would strand a
 * still-`claimed` run for reclaim + double delivery. Holding the claim one extra
 * TTL window (the server TTL is 90s) covers that window — once the relay reports
 * `running` the run is no longer reclaimable, so this is an upper bound, not a wait.
 */
export const WORKFLOW_LOCAL_EXECUTOR_POST_DELIVERY_GRACE_MS = 90_000;

/**
 * Bounded plan-delivery retry (finding 4). A transient runtime hiccup (the local
 * runtime's port briefly closed) must NOT immediately fail the run terminally: the
 * executor retries delivery up to {@link WORKFLOW_LOCAL_DELIVERY_MAX_ATTEMPTS} times
 * with backoff before giving up. A lost/stale claim still aborts immediately (the
 * claim-active check runs between attempts).
 */
export const WORKFLOW_LOCAL_DELIVERY_MAX_ATTEMPTS = 3;

/**
 * Backoff (ms) BEFORE the given 1-based retry attempt. Attempt 1 is the initial try
 * (no wait); attempts 2 and 3 wait ~10s then ~20s, so three attempts span ~30s.
 */
export function workflowDeliveryBackoffMs(attempt: number): number {
  if (attempt <= 1) {
    return 0;
  }
  return (attempt - 1) * 10_000;
}

export const WORKFLOW_LOCAL_EXECUTOR_ERROR_CODES = {
  repoNotAvailable: "local_repo_not_available",
  worktreeCreateFailed: "local_workspace_create_failed",
  worktreeSetupFailed: "local_workspace_setup_failed",
  planDeliveryFailed: "local_plan_delivery_failed",
  staleClaim: "stale_claim",
  unexpectedExecutorError: "local_unexpected_executor_error",
} as const;

/**
 * The runtime plan-delivery body (mirrors anyharness `CreateWorkflowRunRequest`).
 * Intentionally the ONLY shape this executor hands the runtime: `plan` is the
 * server-resolved plan verbatim and `workspaceId` is the fresh worktree. No
 * session id, prompt, model, or agent-kind field exists here — sessions are the
 * runtime's job (forced-bypass `ensure_session`), never the desktop's.
 */
export interface WorkflowRunDeliveryPayload {
  plan: unknown;
  workspaceId: string;
}

/**
 * Map a claimed run + its fresh worktree to the plan-delivery wire.
 *
 * TRAP GUARD: the return type carries exactly `plan` + `workspaceId`. If a future
 * change tried to "deliver" by creating a session (harness/model/prompt), it could
 * not express that through this function — the delivery seam stays the runtime's
 * own plan path, so `ensure_session` forced-bypass always applies.
 */
export function buildWorkflowRunDeliveryPayload(args: {
  resolvedPlan: unknown;
  workspaceId: string;
}): WorkflowRunDeliveryPayload {
  return { plan: args.resolvedPlan, workspaceId: args.workspaceId };
}

// --- repo resolution (D16 repo pin -> local worktree) --------------------------

export interface WorkflowRepositoryIdentity {
  provider: string;
  owner: string;
  name: string;
}

/** The subset of a local repo candidate this module matches against. The desktop
 * builds the full candidate list from the runtime's repo roots (reusing the shared
 * automations candidate builder). */
export interface WorkflowRepoCandidateLike {
  identity: WorkflowRepositoryIdentity;
}

/** Parse a D16 repo pin ("owner/name") into the canonical GitHub identity. Local
 * schedule triggers are GitHub-only (D16), so the provider is fixed. Returns null
 * on a missing/malformed pin. */
export function parseWorkflowRepoPin(
  repoFullName: string | null | undefined,
): WorkflowRepositoryIdentity | null {
  const trimmed = repoFullName?.trim();
  if (!trimmed) {
    return null;
  }
  const segments = trimmed.split("/").filter((segment) => segment.trim().length > 0);
  if (segments.length !== 2) {
    return null;
  }
  const [owner, name] = segments;
  return {
    provider: "github",
    owner: owner.trim().toLowerCase(),
    name: name.trim().toLowerCase(),
  };
}

export function workflowRepoIdentityKey(identity: WorkflowRepositoryIdentity): string {
  return `${identity.provider}:${identity.owner}/${identity.name}`;
}

/** Find the local repo candidate whose identity matches the trigger's repo pin,
 * or null when the desktop has no local clone of that repo. */
export function resolveWorkflowRepoCandidate<T extends WorkflowRepoCandidateLike>(
  candidates: readonly T[],
  repoFullName: string | null | undefined,
): T | null {
  const identity = parseWorkflowRepoPin(repoFullName);
  if (!identity) {
    return null;
  }
  const key = workflowRepoIdentityKey(identity);
  return (
    candidates.find(
      (candidate) => workflowRepoIdentityKey(candidate.identity) === key,
    ) ?? null
  );
}

// --- fresh worktree plan (fresh-by-default, §9) --------------------------------

export interface WorkflowWorktreePlan {
  repoRootId: string;
  branchName: string;
  workspaceName: string;
  displayName: string;
  targetPath: string;
  baseRef: string;
  setupScript: string | null;
}

const MAX_WORKFLOW_DISPLAY_NAME_LENGTH = 160;
const DEFAULT_WORKFLOW_DISPLAY_NAME = "Workflow run";

export function safeWorkflowSlug(label: string, fallback: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^[-._]+|[-._]+$/g, "")
    .slice(0, 48)
    .replace(/\.{2,}/g, ".")
    .replace(/^[-._]+|[-._]+$/g, "");
  return slug || fallback;
}

export function normalizeWorkflowDisplayName(label: string): string {
  const normalized = label.trim().replace(/\s+/g, " ");
  const truncated = normalized.slice(0, MAX_WORKFLOW_DISPLAY_NAME_LENGTH).trim();
  return truncated || DEFAULT_WORKFLOW_DISPLAY_NAME;
}

/** The repo-root fields the worktree plan reads (a structural subset of the
 * runtime's `RepoRoot` / the shared automations candidate). */
export interface WorkflowWorktreeRepoRoot {
  id: string;
  path: string;
  remoteRepoName?: string | null;
  defaultBranch?: string | null;
}

/**
 * Derive a fresh-worktree plan for a claimed run — one new worktree per run
 * (§9 fresh-by-default), keyed on the run id so a re-claim/redelivery is
 * idempotent on the same path. Mirrors the automations worktree-plan derivation.
 */
export function buildWorkflowWorktreePlan(args: {
  runId: string;
  label: string;
  repoRoot: WorkflowWorktreeRepoRoot;
  homeDir: string;
  defaultBranch?: string | null;
  representativeBranch?: string | null;
  setupScript?: string | null;
}): WorkflowWorktreePlan {
  const runSuffix = args.runId.replace(/-/g, "").slice(0, 16) || "run";
  const slug = safeWorkflowSlug(args.label, "run");
  const workspaceName = `workflow-${slug}-${runSuffix}`;
  const repoName =
    args.repoRoot.remoteRepoName?.trim()
    || args.repoRoot.path.split("/").filter(Boolean).pop()
    || "repo";
  const baseRef =
    args.defaultBranch?.trim()
    || args.repoRoot.defaultBranch?.trim()
    || args.representativeBranch?.trim()
    || "HEAD";

  return {
    repoRootId: args.repoRoot.id,
    branchName: `workflow/${slug}-${runSuffix}`,
    workspaceName,
    displayName: normalizeWorkflowDisplayName(args.label),
    targetPath: `${args.homeDir}/.proliferate/worktrees/${repoName}/${workspaceName}`,
    baseRef,
    setupScript: args.setupScript?.trim() || null,
  };
}

// --- heartbeat cadence / backoff -----------------------------------------------

export interface HeartbeatDecisionState {
  consecutiveErrors: number;
}

export type HeartbeatOutcome =
  | { kind: "ok"; accepted: boolean }
  | { kind: "error" };

export interface HeartbeatDecision {
  state: HeartbeatDecisionState;
  /** The claim is gone — the executor must stop touching the run (a rejected
   * heartbeat means reclaimed/terminal; repeated errors mean the server is
   * unreachable and may reclaim). */
  lostClaim: boolean;
}

export function initialHeartbeatState(): HeartbeatDecisionState {
  return { consecutiveErrors: 0 };
}

/**
 * Given the prior heartbeat state and this pulse's outcome, derive the next state
 * and whether the claim is lost. A single rejected (`accepted=false`) pulse loses
 * the claim immediately; transient errors are tolerated up to
 * {@link WORKFLOW_LOCAL_HEARTBEAT_MAX_ERRORS} consecutive failures.
 */
export function evaluateHeartbeat(
  prev: HeartbeatDecisionState,
  outcome: HeartbeatOutcome,
): HeartbeatDecision {
  if (outcome.kind === "ok") {
    if (!outcome.accepted) {
      return { state: { consecutiveErrors: 0 }, lostClaim: true };
    }
    return { state: { consecutiveErrors: 0 }, lostClaim: false };
  }
  const consecutiveErrors = prev.consecutiveErrors + 1;
  return {
    state: { consecutiveErrors },
    lostClaim: consecutiveErrors >= WORKFLOW_LOCAL_HEARTBEAT_MAX_ERRORS,
  };
}

// --- relay re-attach derivation ------------------------------------------------

const REATTACHABLE_LOCAL_STATUSES: ReadonlySet<string> = new Set([
  "delivered",
  "running",
  "waiting_approval",
]);

/** The minimal server-run shape the re-attach predicate reads. */
export interface ReattachRunView {
  targetMode: string;
  status: string;
  anyharnessWorkspaceId?: string | null;
}

/**
 * Should the desktop relay re-register this local run on app start?
 *
 * True only for a LOCAL run the server already advanced past delivery
 * (`delivered`/`running`/`waiting_approval`) AND that carries a workspace id (so
 * the relay knows which runtime workspace to poll). A still-`claimed` run — one
 * the app never got to deliver, or delivered but never reported `running` before
 * closing — is deliberately NOT re-attached here: it is left for the claim poller
 * to re-claim (stale reclaim) and re-deliver (idempotent on run id).
 */
export function shouldReattachLocalRun(run: ReattachRunView): boolean {
  return (
    run.targetMode === "local"
    && REATTACHABLE_LOCAL_STATUSES.has(run.status)
    && Boolean(run.anyharnessWorkspaceId)
  );
}
