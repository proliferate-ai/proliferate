import { useEffect, useMemo, useRef } from "react";
import type {
  LocalAutomationRunClaimResponse,
} from "@/lib/access/cloud/client";
import { useLocalAutomationRunClaims } from "@/hooks/access/cloud/automations/use-local-automation-run-claims";
import { useLocalAutomationRuntimeClientFactory } from "@/hooks/access/anyharness/automations/use-local-automation-runtime-client";
import { useLocalAutomationExecutorCache } from "@/hooks/automations/cache/use-local-automation-executor-cache";
import {
  buildLocalAutomationRepoCandidates,
  buildLocalAutomationWorktreePlan,
  findCandidateForClaim,
  LOCAL_AUTOMATION_ERROR_CODES,
  type LocalAutomationRepoCandidate,
} from "@/lib/domain/automations/local-executor/plan";
import {
  executeLocalAutomationRun,
  LocalAutomationExecutorError,
} from "@/lib/workflows/automations/local-automation-executor";
import { readPersistedValue, persistValue } from "@/lib/infra/persistence/preferences-persistence";
import { useTauriShellActions } from "@/hooks/access/tauri/use-shell-actions";
import { useRepoPreferencesStore } from "@/stores/preferences/repo-preferences-store";
import { useWorkspaces } from "@/hooks/workspaces/cache/use-workspaces";

const AUTOMATION_LOCAL_EXECUTOR_ID_KEY = "automationLocalExecutorId";
const LOCAL_EXECUTOR_POLL_MS = 10_000;
const LOCAL_EXECUTOR_HEARTBEAT_MS = 30_000;

let localExecutorMounted = false;
let executorIdPromise: Promise<string> | null = null;

async function getLocalExecutorId(): Promise<string> {
  if (executorIdPromise) {
    return executorIdPromise;
  }
  executorIdPromise = (async () => {
    const existing = await readPersistedValue<string>(AUTOMATION_LOCAL_EXECUTOR_ID_KEY);
    if (existing?.trim()) {
      return existing.trim();
    }
    const next = `desktop:${crypto.randomUUID()}`;
    await persistValue(AUTOMATION_LOCAL_EXECUTOR_ID_KEY, next);
    return next;
  })();
  return executorIdPromise;
}

// Owns the singleton local automation claim loop and heartbeat cleanup.
// Does not own cloud mutation cache shape or AnyHarness client construction.
export function useLocalAutomationClaimPoller(args: {
  enabled: boolean;
  runtimeUrl: string;
}): void {
  const runClaims = useLocalAutomationRunClaims();
  const createRuntimeClient = useLocalAutomationRuntimeClientFactory();
  const { invalidateAfterLocalAutomationRun } = useLocalAutomationExecutorCache();
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
    if (localExecutorMounted) {
      return;
    }
    localExecutorMounted = true;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (cancelled || activeRef.current) {
        return;
      }
      activeRef.current = true;
      try {
        const executorId = await getLocalExecutorId();
        const response = await runClaims.claimRuns({
          executorId,
          limit: 1,
          availableRepositories: candidates.map((candidate) => candidate.identity),
        });
        const claim = response.runs[0];
        if (claim) {
          await processClaim({
            claim,
            candidates,
            executorId,
            getHomeDir,
            runtimeUrl: args.runtimeUrl,
            runClaims,
            createRuntimeClient,
            invalidateAfterLocalAutomationRun,
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
          console.warn("Local automation claim poll failed", { errorName });
        })
        .finally(() => {
          if (!cancelled) {
            timer = setTimeout(loop, LOCAL_EXECUTOR_POLL_MS);
          }
        });
    };
    loop();

    return () => {
      cancelled = true;
      localExecutorMounted = false;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [
    args.enabled,
    args.runtimeUrl,
    candidates,
    createRuntimeClient,
    getHomeDir,
    invalidateAfterLocalAutomationRun,
    runClaims,
  ]);
}

async function processClaim(args: {
  claim: LocalAutomationRunClaimResponse;
  candidates: readonly LocalAutomationRepoCandidate[];
  executorId: string;
  getHomeDir: () => Promise<string>;
  runtimeUrl: string;
  runClaims: ReturnType<typeof useLocalAutomationRunClaims>;
  createRuntimeClient: ReturnType<typeof useLocalAutomationRuntimeClientFactory>;
  invalidateAfterLocalAutomationRun: ReturnType<
    typeof useLocalAutomationExecutorCache
  >["invalidateAfterLocalAutomationRun"];
}): Promise<void> {
  const candidate = findCandidateForClaim(args.candidates, args.claim);
  if (!candidate) {
    await failClaim(args, LOCAL_AUTOMATION_ERROR_CODES.repoNotAvailable);
    return;
  }

  const homeDir = await args.getHomeDir();
  const repoConfig = useRepoPreferencesStore.getState().repoConfigs[candidate.repoRoot.path];
  const plan = buildLocalAutomationWorktreePlan({
    claim: args.claim,
    candidate,
    homeDir,
    defaultBranch: repoConfig?.defaultBranch,
    setupScript: repoConfig?.setupScript,
  });

  const heartbeat = startHeartbeat(args.claim, args.executorId, args.runClaims.heartbeatRun);
  let claimActive = true;
  const stopOnLostClaim = () => {
    claimActive = false;
  };
  heartbeat.onLostClaim = stopOnLostClaim;
  const client = args.createRuntimeClient({ runtimeUrl: args.runtimeUrl });
  try {
    await executeLocalAutomationRun({
      client,
      claim: args.claim,
      candidate,
      plan,
      transitions: {
        markCreatingWorkspace: () =>
          args.runClaims.markCreatingWorkspace(args.claim.id, actionBody(args)),
        attachWorkspace: (anyharnessWorkspaceId) =>
          args.runClaims.attachWorkspace(args.claim.id, {
            ...actionBody(args),
            anyharnessWorkspaceId,
          }),
        markProvisioningWorkspace: () =>
          args.runClaims.markProvisioningWorkspace(args.claim.id, actionBody(args)),
        markCreatingSession: (anyharnessWorkspaceId) =>
          args.runClaims.markCreatingSession(args.claim.id, {
            ...actionBody(args),
            anyharnessWorkspaceId,
          }),
        attachSession: (anyharnessWorkspaceId, anyharnessSessionId) =>
          args.runClaims.attachSession(args.claim.id, {
            ...actionBody(args),
            anyharnessWorkspaceId,
            anyharnessSessionId,
          }),
        markDispatching: () => args.runClaims.markDispatching(args.claim.id, actionBody(args)),
        markDispatched: (anyharnessWorkspaceId, anyharnessSessionId) =>
          args.runClaims.markDispatched(args.claim.id, {
            ...actionBody(args),
            anyharnessWorkspaceId,
            anyharnessSessionId,
          }),
      },
      shouldContinue: () => claimActive,
    });
  } catch (error) {
    const code = error instanceof LocalAutomationExecutorError
      ? error.code
      : LOCAL_AUTOMATION_ERROR_CODES.unexpectedExecutorError;
    await failClaim(args, code);
  } finally {
    heartbeat.stop();
    await args.invalidateAfterLocalAutomationRun({
      automationId: args.claim.automationId,
      runtimeUrl: args.runtimeUrl,
    });
  }
}

function actionBody(args: {
  executorId: string;
  claim: Pick<LocalAutomationRunClaimResponse, "claimId">;
}) {
  return {
    executorId: args.executorId,
    claimId: args.claim.claimId,
  };
}

function startHeartbeat(
  claim: LocalAutomationRunClaimResponse,
  executorId: string,
  heartbeatRun: ReturnType<typeof useLocalAutomationRunClaims>["heartbeatRun"],
): { stop: () => void; onLostClaim?: () => void } {
  let consecutiveErrors = 0;
  let stopped = false;
  const controller: { stop: () => void; onLostClaim?: () => void } = {
    stop: () => {
      stopped = true;
      clearInterval(interval);
    },
  };
  const pulse = async () => {
    try {
      const response = await heartbeatRun(claim.id, {
        executorId,
        claimId: claim.claimId,
      });
      consecutiveErrors = 0;
      if (!response.accepted) {
        controller.onLostClaim?.();
      }
    } catch {
      consecutiveErrors += 1;
      if (consecutiveErrors >= 2) {
        controller.onLostClaim?.();
      }
    }
  };
  const interval = setInterval(() => {
    if (!stopped) {
      void pulse();
    }
  }, LOCAL_EXECUTOR_HEARTBEAT_MS);
  return controller;
}

async function failClaim(
  args: {
    claim: LocalAutomationRunClaimResponse;
    executorId: string;
    runClaims: ReturnType<typeof useLocalAutomationRunClaims>;
  },
  errorCode: string,
): Promise<void> {
  await args.runClaims.markFailed(args.claim.id, {
    executorId: args.executorId,
    claimId: args.claim.claimId,
    errorCode,
  }).catch(() => undefined);
}
