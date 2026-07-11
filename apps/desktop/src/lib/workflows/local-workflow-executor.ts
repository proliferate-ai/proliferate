/**
 * Desktop workflow executor (track 2a; lifts L15).
 *
 * Given a claimed local run + its fresh worktree plan, this: mints the worktree,
 * waits for its setup to finish, and delivers the resolved plan to the LOCAL
 * runtime through the runtime's own plan-delivery wire. It then returns the
 * workspace id so the caller can register the run with the 2s relay.
 *
 * THE TRAP (mental-model §11 / build-program §2a): the *automations* executor
 * opens sessions via the `@anyharness/sdk` (`sessions.create` / `promptText`),
 * bypassing the Rust forced-bypass exec policy — unattended runs then stall on a
 * permission prompt. This executor structurally cannot do that: its dependency
 * type ({@link WorkflowExecutorDeps}) exposes ONLY workspace operations plus a
 * `deliverPlan` seam that hands `{ plan, workspaceId }` to the runtime. There is no
 * `sessions` handle in scope, so sessions are created by the runtime under
 * `ensure_session` (forced bypass) — re-routing through the SDK session path would
 * be a type error here, not a silent policy regression.
 */

import { AnyHarnessError } from "@anyharness/sdk";
import type {
  CreateWorktreeWorkspaceResponse,
  GetSetupStatusResponse,
} from "@anyharness/sdk";
import {
  buildWorkflowRunDeliveryPayload,
  WORKFLOW_LOCAL_DELIVERY_MAX_ATTEMPTS,
  WORKFLOW_LOCAL_EXECUTOR_ERROR_CODES,
  workflowDeliveryBackoffMs,
  type WorkflowRunDeliveryPayload,
  type WorkflowWorktreePlan,
} from "@/lib/domain/workflows/local-executor";

const WORKFLOW_LOCAL_ORIGIN = { kind: "system", entrypoint: "desktop" } as const;
const SETUP_POLL_INTERVAL_MS = 2_000;
const SETUP_TIMEOUT_MS = 360_000;

export class LocalWorkflowExecutorError extends Error {
  constructor(public readonly code: string, message?: string) {
    super(message ?? code);
    this.name = "LocalWorkflowExecutorError";
  }
}

/**
 * The runtime capabilities the executor needs — deliberately narrow. `deliverPlan`
 * is the runtime's plan-delivery wire (`POST /v1/workflow-runs`); the three
 * workspace ops mint + provision the fresh worktree. There is NO session surface
 * (that is the whole point — see the module docstring's TRAP note).
 */
export interface WorkflowExecutorDeps {
  createWorktree: (input: {
    repoRootId: string;
    newBranchName: string;
    targetPath: string;
    baseBranch: string;
    setupScript?: string | null;
    origin: typeof WORKFLOW_LOCAL_ORIGIN;
  }) => Promise<CreateWorktreeWorkspaceResponse>;
  getSetupStatus: (workspaceId: string) => Promise<GetSetupStatusResponse>;
  startSetup: (
    workspaceId: string,
    input: { command: string; baseRef: string },
  ) => Promise<GetSetupStatusResponse>;
  /** Hand the resolved plan to the local runtime (`POST /v1/workflow-runs`). */
  deliverPlan: (payload: WorkflowRunDeliveryPayload) => Promise<{ workspaceId: string }>;
}

export interface ExecuteLocalWorkflowRunInput {
  deps: WorkflowExecutorDeps;
  /** The server-resolved plan, delivered to the runtime verbatim. */
  resolvedPlan: unknown;
  plan: WorkflowWorktreePlan;
  /** Reused by the claim heartbeat to abort a lost claim between phases. */
  shouldContinue?: () => boolean;
}

export interface ExecuteLocalWorkflowRunResult {
  workspaceId: string;
}

/**
 * Mint the worktree, wait for setup, deliver the plan. Returns the fresh
 * workspace id. Throws {@link LocalWorkflowExecutorError} with a stable code on any
 * step failure so the caller can report the run `failed` through the /status path.
 */
export async function executeLocalWorkflowRun(
  input: ExecuteLocalWorkflowRunInput,
): Promise<ExecuteLocalWorkflowRunResult> {
  ensureClaimActive(input);
  const workspaceId = await createWorktree(input);
  ensureClaimActive(input);
  await waitForSetup(input, workspaceId);
  ensureClaimActive(input);

  // Plan delivery — the runtime opens sessions itself (forced bypass). This is the
  // ONLY handoff to the runtime; no SDK session is ever created here.
  const payload = buildWorkflowRunDeliveryPayload({
    resolvedPlan: input.resolvedPlan,
    workspaceId,
  });
  return { workspaceId: await deliverWithRetry(input, payload) };
}

/**
 * Deliver the plan with bounded retry + backoff (finding 4): a transient runtime
 * hiccup (port briefly closed) is retried up to {@link WORKFLOW_LOCAL_DELIVERY_MAX_ATTEMPTS}
 * times over ~30s before failing the run terminally. A lost/stale claim aborts
 * immediately — {@link ensureClaimActive} runs before each attempt and throws
 * `staleClaim`, which the caller does NOT convert into a terminal failure.
 */
async function deliverWithRetry(
  input: ExecuteLocalWorkflowRunInput,
  payload: WorkflowRunDeliveryPayload,
): Promise<string> {
  for (let attempt = 1; ; attempt += 1) {
    ensureClaimActive(input);
    try {
      const view = await input.deps.deliverPlan(payload);
      return view.workspaceId;
    } catch {
      if (attempt >= WORKFLOW_LOCAL_DELIVERY_MAX_ATTEMPTS) {
        throw new LocalWorkflowExecutorError(
          WORKFLOW_LOCAL_EXECUTOR_ERROR_CODES.planDeliveryFailed,
        );
      }
      // A lost claim aborts immediately — never sit out a backoff for a run another
      // device now owns (throws `staleClaim`, which the caller does not treat as a
      // terminal delivery failure).
      ensureClaimActive(input);
      await delay(workflowDeliveryBackoffMs(attempt + 1));
    }
  }
}

async function createWorktree(input: ExecuteLocalWorkflowRunInput): Promise<string> {
  try {
    const response = await input.deps.createWorktree({
      repoRootId: input.plan.repoRootId,
      newBranchName: input.plan.branchName,
      targetPath: input.plan.targetPath,
      baseBranch: input.plan.baseRef,
      setupScript: input.plan.setupScript,
      origin: WORKFLOW_LOCAL_ORIGIN,
    });
    return response.workspace.id;
  } catch {
    throw new LocalWorkflowExecutorError(
      WORKFLOW_LOCAL_EXECUTOR_ERROR_CODES.worktreeCreateFailed,
    );
  }
}

type SetupStatusLookup =
  | { kind: "found"; status: GetSetupStatusResponse }
  | { kind: "missing" }
  | { kind: "unavailable" };

async function waitForSetup(
  input: ExecuteLocalWorkflowRunInput,
  workspaceId: string,
): Promise<void> {
  if (!input.plan.setupScript) {
    return;
  }
  const command = input.plan.setupScript;
  const deadline = Date.now() + SETUP_TIMEOUT_MS;
  let restartedAfterMissingStatus = false;
  while (Date.now() < deadline) {
    ensureClaimActive(input);
    const lookup = await getSetupStatus(input.deps, workspaceId);
    if (lookup.kind === "unavailable") {
      await delay(SETUP_POLL_INTERVAL_MS);
      continue;
    }
    if (lookup.kind === "missing") {
      if (!restartedAfterMissingStatus) {
        try {
          await input.deps.startSetup(workspaceId, { command, baseRef: input.plan.baseRef });
          restartedAfterMissingStatus = true;
        } catch {
          await delay(SETUP_POLL_INTERVAL_MS);
          continue;
        }
      }
      await delay(SETUP_POLL_INTERVAL_MS);
      continue;
    }
    const status = lookup.status.status;
    if (status === "succeeded") {
      return;
    }
    if (status === "failed") {
      throw new LocalWorkflowExecutorError(
        WORKFLOW_LOCAL_EXECUTOR_ERROR_CODES.worktreeSetupFailed,
      );
    }
    await delay(SETUP_POLL_INTERVAL_MS);
  }
  throw new LocalWorkflowExecutorError(
    WORKFLOW_LOCAL_EXECUTOR_ERROR_CODES.worktreeSetupFailed,
  );
}

async function getSetupStatus(
  deps: WorkflowExecutorDeps,
  workspaceId: string,
): Promise<SetupStatusLookup> {
  try {
    return { kind: "found", status: await deps.getSetupStatus(workspaceId) };
  } catch (error) {
    if (
      error instanceof AnyHarnessError
      && (error.problem.status === 404 || error.problem.code === "SETUP_NOT_FOUND")
    ) {
      return { kind: "missing" };
    }
    return { kind: "unavailable" };
  }
}

function isClaimActive(input: ExecuteLocalWorkflowRunInput): boolean {
  return input.shouldContinue?.() ?? true;
}

function ensureClaimActive(input: ExecuteLocalWorkflowRunInput): void {
  if (!isClaimActive(input)) {
    throw new LocalWorkflowExecutorError(WORKFLOW_LOCAL_EXECUTOR_ERROR_CODES.staleClaim);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
