import { useEffect, useMemo, useRef } from "react";
import type { WorkflowRunResponse } from "@/lib/access/cloud/workflows";
import { buildLocalWorkflowExecutorDeps } from "@/lib/access/anyharness/workflow-runs";
import { useLocalWorkflowRunClaims } from "@/hooks/access/cloud/workflows/use-local-workflow-run-claims";
import { buildLocalAutomationRepoCandidates } from "@/lib/domain/automations/local-executor/plan";
import {
  buildWorkflowWorktreePlan,
  evaluateHeartbeat,
  initialHeartbeatState,
  resolveWorkflowRepoCandidate,
  WORKFLOW_LOCAL_EXECUTOR_ERROR_CODES,
  WORKFLOW_LOCAL_EXECUTOR_HEARTBEAT_MS,
  WORKFLOW_LOCAL_EXECUTOR_POLL_MS,
  WORKFLOW_LOCAL_EXECUTOR_POST_DELIVERY_GRACE_MS,
  type HeartbeatDecisionState,
} from "@/lib/domain/workflows/local-executor";
import {
  executeLocalWorkflowRun,
  LocalWorkflowExecutorError,
  type WorkflowExecutorDeps,
} from "@/lib/workflows/local-workflow-executor";
import { readPersistedValue, persistValue } from "@/lib/infra/persistence/preferences-persistence";
import { useTauriShellActions } from "@/hooks/access/tauri/use-shell-actions";
import { useRepoPreferencesStore } from "@/stores/preferences/repo-preferences-store";
import { useWorkspaces } from "@/hooks/workspaces/cache/use-workspaces";
import { useWorkflowRelayStore } from "@/stores/workflows/workflow-relay-store";

const WORKFLOW_LOCAL_EXECUTOR_ID_KEY = "workflowLocalExecutorId";
const WORKFLOW_RUN_LABEL = "Workflow run";

let workflowExecutorMounted = false;
let executorIdPromise: Promise<string> | null = null;

async function getWorkflowExecutorId(): Promise<string> {
  if (executorIdPromise) {
    return executorIdPromise;
  }
  executorIdPromise = (async () => {
    const existing = await readPersistedValue<string>(WORKFLOW_LOCAL_EXECUTOR_ID_KEY);
    if (existing?.trim()) {
      return existing.trim();
    }
    const next = `desktop:${crypto.randomUUID()}`;
    await persistValue(WORKFLOW_LOCAL_EXECUTOR_ID_KEY, next);
    return next;
  })();
  return executorIdPromise;
}

/**
 * Singleton desktop workflow claim loop (track 2a; lifts L15). While the app is
 * open it polls (10s) for this owner's `claimable` local scheduled runs, mints a
 * fresh worktree per run, and delivers each run's resolved plan to the LOCAL
 * runtime through the runtime's own plan-delivery wire — then registers the run
 * with the 2s relay so observed state flows back to the server.
 *
 * Coexists with the automations claim poller (D-001): a separate app-wide
 * instance, its own executor id + heartbeat, claiming from the workflow endpoints.
 *
 * THE TRAP (§11): delivery goes through {@link executeLocalWorkflowRun}, whose
 * dependency surface has NO session methods — sessions are opened by the runtime
 * under `ensure_session` forced bypass, so unattended runs never stall on a
 * permission prompt. Contrast the automations executor, which opens SDK sessions.
 */
export function useLocalWorkflowClaimPoller(args: {
  enabled: boolean;
  runtimeUrl: string;
}): void {
  const runClaims = useLocalWorkflowRunClaims();
  const register = useWorkflowRelayStore((state) => state.register);
  const { getHomeDir } = useTauriShellActions();
  const workspacesQuery = useWorkspaces();
  const activeRef = useRef(false);

  const candidates = useMemo(
    () =>
      buildLocalAutomationRepoCandidates({
        repoRoots: workspacesQuery.data?.repoRoots ?? [],
        workspaces: workspacesQuery.data?.localWorkspaces ?? [],
      }),
    [workspacesQuery.data],
  );

  useEffect(() => {
    if (!args.enabled || !args.runtimeUrl.trim() || candidates.length === 0) {
      return;
    }
    if (workflowExecutorMounted) {
      return;
    }
    workflowExecutorMounted = true;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (cancelled || activeRef.current) {
        return;
      }
      activeRef.current = true;
      try {
        const executorId = await getWorkflowExecutorId();
        const response = await runClaims.claimRuns({ executorId, limit: 1 });
        const claim = response.runs[0];
        if (claim) {
          await processClaim({
            claim,
            candidates,
            executorId,
            getHomeDir,
            runtimeUrl: args.runtimeUrl,
            runClaims,
            register,
          });
        }
      } finally {
        activeRef.current = false;
      }
    };

    const loop = () => {
      void tick()
        .catch((error) => {
          const errorName = error instanceof Error ? error.name : typeof error;
          console.warn("Local workflow claim poll failed", { errorName });
        })
        .finally(() => {
          if (!cancelled) {
            timer = setTimeout(loop, WORKFLOW_LOCAL_EXECUTOR_POLL_MS);
          }
        });
    };
    loop();

    return () => {
      cancelled = true;
      workflowExecutorMounted = false;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [args.enabled, args.runtimeUrl, candidates, getHomeDir, register, runClaims]);
}

async function processClaim(args: {
  claim: WorkflowRunResponse;
  candidates: ReturnType<typeof buildLocalAutomationRepoCandidates>;
  executorId: string;
  getHomeDir: () => Promise<string>;
  runtimeUrl: string;
  runClaims: ReturnType<typeof useLocalWorkflowRunClaims>;
  register: ReturnType<typeof useWorkflowRelayStore.getState>["register"];
}): Promise<void> {
  const { claim, runtimeUrl } = args;
  const claimId = claim.claimId;
  if (!claimId) {
    // A claimed run always carries its claim id; a payload without one cannot be
    // heartbeated, so treat it as an unexpected server state and skip.
    return;
  }

  // Resolve the D16 repo pin (the desktop worktree hint) from the run's trigger,
  // then to a local clone. A transient trigger-read failure throws out of here so
  // the claim simply lapses (TTL) and is reclaimed + retried next cycle — the run
  // is NOT terminally failed on a network blip.
  const repoFullName = await resolveTriggerRepoFullName(args);
  const candidate = resolveWorkflowRepoCandidate(args.candidates, repoFullName);
  if (!candidate) {
    // Trigger read succeeded but this desktop has no clone of the pinned repo (or
    // the trigger was deleted): the run is not this laptop's to execute — report a
    // clean terminal failure rather than spin re-claiming it.
    await failClaim(
      args.runClaims,
      claim.id,
      WORKFLOW_LOCAL_EXECUTOR_ERROR_CODES.repoNotAvailable,
      claimId,
    );
    return;
  }

  const homeDir = await args.getHomeDir();
  const repoConfig = useRepoPreferencesStore.getState().repoConfigs[candidate.repoRoot.path];
  const plan = buildWorkflowWorktreePlan({
    runId: claim.id,
    label: WORKFLOW_RUN_LABEL,
    repoRoot: candidate.repoRoot,
    homeDir,
    defaultBranch: repoConfig?.defaultBranch,
    representativeBranch:
      candidate.representativeWorkspace?.currentBranch
      ?? candidate.representativeWorkspace?.originalBranch,
    setupScript: repoConfig?.setupScript,
  });

  const heartbeat = startHeartbeat(claim.id, args.executorId, claimId, args.runClaims);
  const deps = buildExecutorDeps(runtimeUrl);
  try {
    const result = await executeLocalWorkflowRun({
      deps,
      resolvedPlan: claim.resolvedPlan,
      plan,
      shouldContinue: () => heartbeat.claimActive,
    });
    // Hand the run to the 2s relay: it reports `running` (claimed -> running) and
    // round-trips terminal state. On app restart the relay re-attaches this run
    // once the server records its workspace (see `shouldReattachLocalRun`).
    args.register(claim.id, { workspaceId: result.workspaceId, runtimeUrl, claimId });
    // Finding 3: keep the claim's heartbeat alive one extra TTL window instead of
    // dropping it the instant the plan is delivered. This covers the crash window
    // between "plan delivered" and the relay's first `running` report — while the
    // run is still `claimed` it would otherwise be reclaimed + double-delivered.
    // Once the relay reports `running` the run is no longer reclaimable, so the
    // grace is an upper bound; the interval simply lapses when it elapses.
    heartbeat.scheduleStop(WORKFLOW_LOCAL_EXECUTOR_POST_DELIVERY_GRACE_MS);
    return;
  } catch (error) {
    const code =
      error instanceof LocalWorkflowExecutorError
        ? error.code
        : WORKFLOW_LOCAL_EXECUTOR_ERROR_CODES.unexpectedExecutorError;
    // A lost claim is already owned by someone else — don't stomp its status.
    if (code !== WORKFLOW_LOCAL_EXECUTOR_ERROR_CODES.staleClaim && heartbeat.claimActive) {
      await failClaim(args.runClaims, claim.id, code, claimId);
    }
    heartbeat.stop();
  }
}

/** Build the runtime deps the executor needs — worktree ops via the AnyHarness
 * SDK (workspace ops, NOT sessions) and plan delivery via the runtime's own
 * `POST /v1/workflow-runs` wire (the same wire a manual local run uses). Kept
 * behind the AnyHarness access boundary in `lib/access/anyharness/workflow-runs`. */
function buildExecutorDeps(runtimeUrl: string): WorkflowExecutorDeps {
  return buildLocalWorkflowExecutorDeps(runtimeUrl);
}

async function resolveTriggerRepoFullName(args: {
  claim: WorkflowRunResponse;
  runClaims: ReturnType<typeof useLocalWorkflowRunClaims>;
}): Promise<string | null> {
  const triggerId = args.claim.triggerId;
  if (!triggerId) {
    return null;
  }
  // Deliberately NOT wrapped in try/catch: a transient read failure propagates so
  // the caller lets the claim lapse (TTL) and retry, instead of terminally failing
  // the run. A missing trigger row resolves to null -> a clean repo-not-available.
  const { triggers } = await args.runClaims.listTriggers(args.claim.workflowId);
  const trigger = triggers.find((entry) => entry.id === triggerId);
  return trigger?.repoFullName ?? null;
}

interface WorkflowHeartbeatController {
  claimActive: boolean;
  stop: () => void;
  /** Stop the heartbeat after a delay (finding 3: hold the claim one extra TTL
   * window past delivery so a crash before `running` can't strand a `claimed`
   * run). A no-op if the heartbeat was already stopped. */
  scheduleStop: (afterMs: number) => void;
}

function startHeartbeat(
  runId: string,
  executorId: string,
  claimId: string,
  runClaims: ReturnType<typeof useLocalWorkflowRunClaims>,
): WorkflowHeartbeatController {
  let state: HeartbeatDecisionState = initialHeartbeatState();
  let stopped = false;
  const controller: WorkflowHeartbeatController = {
    claimActive: true,
    stop: () => {
      stopped = true;
      clearInterval(interval);
    },
    scheduleStop: (afterMs: number) => {
      if (stopped) {
        return;
      }
      setTimeout(() => controller.stop(), afterMs);
    },
  };
  const pulse = async () => {
    try {
      const response = await runClaims.heartbeatRun(runId, { executorId, claimId });
      const decision = evaluateHeartbeat(state, { kind: "ok", accepted: response.accepted });
      state = decision.state;
      if (decision.lostClaim) {
        controller.claimActive = false;
      }
    } catch {
      const decision = evaluateHeartbeat(state, { kind: "error" });
      state = decision.state;
      if (decision.lostClaim) {
        controller.claimActive = false;
      }
    }
  };
  const interval = setInterval(() => {
    if (!stopped) {
      void pulse();
    }
  }, WORKFLOW_LOCAL_EXECUTOR_HEARTBEAT_MS);
  return controller;
}

async function failClaim(
  runClaims: ReturnType<typeof useLocalWorkflowRunClaims>,
  runId: string,
  errorCode: string,
  claimId: string,
): Promise<void> {
  await runClaims.reportFailed(runId, errorCode, claimId).catch(() => undefined);
}
