import { getAnyHarnessClient } from "@anyharness/sdk-react";
import { useEffect, useMemo, useRef } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type {
  LocalAutomationRunClaimResponse,
} from "@/lib/access/cloud/client";
import {
  attachLocalAutomationRunSession,
  attachLocalAutomationRunWorkspace,
  claimLocalAutomationRuns,
  heartbeatLocalAutomationRun,
  markLocalAutomationRunCreatingSession,
  markLocalAutomationRunCreatingWorkspace,
  markLocalAutomationRunDispatched,
  markLocalAutomationRunDispatching,
  markLocalAutomationRunFailed,
  markLocalAutomationRunProvisioningWorkspace,
} from "@/lib/access/cloud/automations";
import {
  buildLocalAutomationRepoCandidates,
  buildLocalAutomationWorktreePlan,
  findCandidateForClaim,
  LOCAL_AUTOMATION_ERROR_CODES,
  type LocalAutomationRepoCandidate,
} from "@/lib/domain/automations/local-executor";
import {
  executeLocalAutomationRun,
  LocalAutomationExecutorError,
} from "@/lib/workflows/automations/local-automation-executor";
import { readPersistedValue, persistValue } from "@/lib/infra/persistence/preferences-persistence";
import { getHomeDir } from "@/lib/access/tauri/shell";
import { useRepoPreferencesStore } from "@/stores/preferences/repo-preferences-store";
import { useWorkspaces } from "@/hooks/workspaces/use-workspaces";
import { workspaceCollectionsScopeKey } from "@/hooks/workspaces/query-keys";
import { automationRunsKey } from "./query-keys";

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

export function useLocalAutomationClaimPoller(args: {
  enabled: boolean;
  runtimeUrl: string;
}): void {
  const queryClient = useQueryClient();
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
        const response = await claimLocalAutomationRuns({
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
            runtimeUrl: args.runtimeUrl,
            queryClient,
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
  }, [args.enabled, args.runtimeUrl, candidates, queryClient]);
}

async function processClaim(args: {
  claim: LocalAutomationRunClaimResponse;
  candidates: readonly LocalAutomationRepoCandidate[];
  executorId: string;
  runtimeUrl: string;
  queryClient: QueryClient;
}): Promise<void> {
  const candidate = findCandidateForClaim(args.candidates, args.claim);
  if (!candidate) {
    await failClaim(args, LOCAL_AUTOMATION_ERROR_CODES.repoNotAvailable);
    return;
  }

  const homeDir = await getHomeDir();
  const repoConfig = useRepoPreferencesStore.getState().repoConfigs[candidate.repoRoot.path];
  const plan = buildLocalAutomationWorktreePlan({
    claim: args.claim,
    candidate,
    homeDir,
    defaultBranch: repoConfig?.defaultBranch,
    setupScript: repoConfig?.setupScript,
  });

  const heartbeat = startHeartbeat(args.claim, args.executorId);
  let claimActive = true;
  const stopOnLostClaim = () => {
    claimActive = false;
  };
  heartbeat.onLostClaim = stopOnLostClaim;
  const client = getAnyHarnessClient({ runtimeUrl: args.runtimeUrl });
  try {
    await executeLocalAutomationRun({
      client,
      claim: args.claim,
      candidate,
      plan,
      transitions: {
        markCreatingWorkspace: () =>
          markLocalAutomationRunCreatingWorkspace(args.claim.id, actionBody(args)),
        attachWorkspace: (anyharnessWorkspaceId) =>
          attachLocalAutomationRunWorkspace(args.claim.id, {
            ...actionBody(args),
            anyharnessWorkspaceId,
          }),
        markProvisioningWorkspace: () =>
          markLocalAutomationRunProvisioningWorkspace(args.claim.id, actionBody(args)),
        markCreatingSession: (anyharnessWorkspaceId) =>
          markLocalAutomationRunCreatingSession(args.claim.id, {
            ...actionBody(args),
            anyharnessWorkspaceId,
          }),
        attachSession: (anyharnessWorkspaceId, anyharnessSessionId) =>
          attachLocalAutomationRunSession(args.claim.id, {
            ...actionBody(args),
            anyharnessWorkspaceId,
            anyharnessSessionId,
          }),
        markDispatching: () => markLocalAutomationRunDispatching(args.claim.id, actionBody(args)),
        markDispatched: (anyharnessWorkspaceId, anyharnessSessionId) =>
          markLocalAutomationRunDispatched(args.claim.id, {
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
    await Promise.all([
      args.queryClient.invalidateQueries({ queryKey: automationRunsKey(args.claim.automationId) }),
      args.queryClient.invalidateQueries({
        queryKey: workspaceCollectionsScopeKey(args.runtimeUrl),
      }),
    ]);
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
      const response = await heartbeatLocalAutomationRun(claim.id, {
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
  },
  errorCode: string,
): Promise<void> {
  await markLocalAutomationRunFailed(args.claim.id, {
    executorId: args.executorId,
    claimId: args.claim.claimId,
    errorCode,
  }).catch(() => undefined);
}
