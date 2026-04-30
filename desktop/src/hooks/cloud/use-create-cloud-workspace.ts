import { useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  CloudWorkspaceDetail,
  CreateCloudWorkspaceRequest,
} from "@/lib/integrations/cloud/client";
import { createCloudWorkspace } from "@/lib/integrations/cloud/workspaces";
import { cloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud-ids";
import {
  buildNextCloudWorkspaceAttempt,
  collectKnownCloudBranchNames,
  buildCloudWorkspaceAttemptFromRequest,
  type CloudWorkspaceRepoTarget,
  isCloudWorkspaceBranchConflictError,
} from "@/lib/domain/workspaces/cloud-workspace-creation";
import {
  buildSubmittingPendingWorkspaceEntry,
  createPendingWorkspaceAttemptId,
  type PendingWorkspaceEntry,
} from "@/lib/domain/workspaces/pending-entry";
import { clearCachedCloudConnections } from "@/lib/integrations/anyharness/runtime-target";
import { useWorkspaceSelection } from "@/hooks/workspaces/selection/use-workspace-selection";
import { useWorkspaceEntryFlow } from "@/hooks/workspaces/use-workspace-entry-flow";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { ensureRepoGroupExpanded } from "@/stores/preferences/workspace-ui-store";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";
import { useAuthStore } from "@/stores/auth/auth-store";
import { workspaceCollectionsScopeKey, getWorkspaceCollectionsFromCache } from "@/hooks/workspaces/query-keys";
import {
  type WorkspaceCollections,
  upsertCloudWorkspaceCollections,
} from "@/lib/domain/workspaces/collections";
import { cloudBillingKey, cloudCredentialsKey } from "./query-keys";
import { useCloudCredentialActions } from "./use-cloud-credential-actions";
import { autoSyncDetectedCloudCredentialsIfNeeded } from "./cloud-credential-recovery";
import {
  captureTelemetryException,
  trackProductEvent,
} from "@/lib/integrations/telemetry/client";
import {
  elapsedMs,
  logLatency,
  startLatencyTimer,
} from "@/lib/infra/debug-latency";

const MAX_CLOUD_CREATE_ATTEMPTS = 3;

interface CreateCloudWorkspaceAndEnterOptions {
  repoGroupKeyToExpand?: string | null;
  latencyFlowId?: string | null;
}

export type CloudWorkspaceEntryResult =
  | { status: "ready"; workspaceId: string; cloudWorkspaceId: string; attemptId: string }
  | { status: "awaiting-ready"; workspaceId: string; cloudWorkspaceId: string; attemptId: string }
  | { status: "interrupted" };

function resolveErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function isAttemptCurrent(attemptId: string): boolean {
  return useHarnessStore.getState().pendingWorkspaceEntry?.attemptId === attemptId;
}

function buildRepoTargetFromRequest(
  request: CreateCloudWorkspaceRequest,
): CloudWorkspaceRepoTarget {
  return {
    gitOwner: request.gitOwner,
    gitRepoName: request.gitRepoName,
    baseBranch: request.baseBranch ?? null,
  };
}

export function useCreateCloudWorkspace() {
  const queryClient = useQueryClient();
  const runtimeUrl = useHarnessStore((state) => state.runtimeUrl);
  const setPendingWorkspaceEntry = useHarnessStore((state) => state.setPendingWorkspaceEntry);
  const branchPrefixType = useUserPreferencesStore((state) => state.branchPrefixType);
  const authUser = useAuthStore((state) => state.user);
  const { selectWorkspace } = useWorkspaceSelection();
  const { beginPendingWorkspace, failPendingEntry, finalizeSelection } = useWorkspaceEntryFlow();
  const { syncCloudCredential } = useCloudCredentialActions();

  const createMutation = useMutation<CloudWorkspaceDetail, Error, Parameters<typeof createCloudWorkspace>[0]>({
    meta: {
      telemetryHandled: true,
    },
    mutationFn: async (input) => {
      try {
        return await createCloudWorkspace(input);
      } catch (error) {
        const didSync = await autoSyncDetectedCloudCredentialsIfNeeded(
          error,
          syncCloudCredential,
        );
        if (!didSync) {
          throw error;
        }
        return await createCloudWorkspace(input);
      }
    },
    onSuccess: async (workspace) => {
      await clearCachedCloudConnections(workspace.id);
      queryClient.setQueriesData<WorkspaceCollections | undefined>(
        { queryKey: workspaceCollectionsScopeKey(runtimeUrl) },
        (collections) => upsertCloudWorkspaceCollections(collections, workspace),
      );
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: workspaceCollectionsScopeKey(runtimeUrl),
        }),
        queryClient.invalidateQueries({
          queryKey: cloudBillingKey(),
        }),
        queryClient.invalidateQueries({
          queryKey: cloudCredentialsKey(),
        }),
      ]);
    },
  });
  const { mutateAsync: createCloudWorkspaceMutation } = createMutation;

  const runCloudWorkspaceCreateFlow = useCallback(async (args: {
    target: CloudWorkspaceRepoTarget;
    initialRequest?: CreateCloudWorkspaceRequest;
    allowConflictRetry: boolean;
    repoGroupKeyToExpand?: string | null;
    latencyFlowId?: string | null;
  }): Promise<CloudWorkspaceEntryResult> => {
    const startedAt = startLatencyTimer();
    const repoLabel = `${args.target.gitOwner}/${args.target.gitRepoName}`;
    const attemptId = createPendingWorkspaceAttemptId();
    const cloudWorkspaces = getWorkspaceCollectionsFromCache(
      queryClient,
      runtimeUrl,
    )?.cloudWorkspaces ?? [];
    const knownBranchNames = collectKnownCloudBranchNames({
      target: args.target,
      cloudWorkspaces,
    });

    let triedBranchNames = new Set<string>(
      args.initialRequest ? [args.initialRequest.branchName] : [],
    );
    let currentEntry: PendingWorkspaceEntry | null = null;
    let retryCount = 0;
    const maxAttempts = args.allowConflictRetry ? MAX_CLOUD_CREATE_ATTEMPTS : 1;

    for (let attemptCount = 1; attemptCount <= maxAttempts; attemptCount += 1) {
      const attempt = attemptCount === 1 && args.initialRequest
        ? buildCloudWorkspaceAttemptFromRequest(args.initialRequest)
        : buildNextCloudWorkspaceAttempt({
          target: args.target,
          branchPrefixType,
          authUser,
          knownBranchNames,
          triedBranchNames,
        });
      triedBranchNames = attempt.triedBranchNames;

      const nextEntry = buildSubmittingPendingWorkspaceEntry({
        attemptId,
        selectedWorkspaceId: useHarnessStore.getState().selectedWorkspaceId,
        source: "cloud-created",
        displayName: attempt.request.displayName ?? attempt.branchName,
        repoLabel,
        baseBranchName: attempt.request.baseBranch ?? null,
        request: { kind: "cloud", input: attempt.request },
      });

      if (currentEntry === null) {
        beginPendingWorkspace(nextEntry);
      } else if (isAttemptCurrent(attemptId)) {
        setPendingWorkspaceEntry(nextEntry);
      } else {
        return { status: "interrupted" };
      }
      currentEntry = nextEntry;

      try {
        const requestStartedAt = startLatencyTimer();
        logLatency("workspace.cloud_create.request.start", {
          attemptId,
          repoLabel,
          branchName: attempt.branchName,
          attemptCount,
        });
        const workspace = await createCloudWorkspaceMutation(attempt.request);
        trackProductEvent("cloud_workspace_created", {
          workspace_kind: "cloud",
          status: workspace.status,
          git_provider: workspace.repo.provider,
          attempt_count: attemptCount,
          retry_count: retryCount,
        });
        logLatency("workspace.cloud_create.request.success", {
          attemptId,
          workspaceId: workspace.id,
          status: workspace.status,
          attemptCount,
          retryCount,
          requestElapsedMs: elapsedMs(requestStartedAt),
          totalElapsedMs: elapsedMs(startedAt),
        });
        if (!isAttemptCurrent(attemptId)) {
          return { status: "interrupted" };
        }

        const workspaceId = cloudWorkspaceSyntheticId(workspace.id);
        const updatedEntry: PendingWorkspaceEntry = {
          ...nextEntry,
          stage: workspace.status === "ready" ? "submitting" : "awaiting-cloud-ready",
          workspaceId,
          baseBranchName: workspace.repo.baseBranch,
          request: { kind: "select-existing", workspaceId },
        };
        setPendingWorkspaceEntry(updatedEntry);

        if (workspace.status === "ready") {
          const selectionFinalized = await finalizeSelection(updatedEntry, workspaceId, {
            latencyFlowId: args.latencyFlowId,
            repoGroupKeyToExpand: args.repoGroupKeyToExpand,
          });
          if (!selectionFinalized) {
            return { status: "interrupted" };
          }
          return {
            status: "ready",
            workspaceId,
            cloudWorkspaceId: workspace.id,
            attemptId,
          };
        }

        if (args.repoGroupKeyToExpand) {
          ensureRepoGroupExpanded(args.repoGroupKeyToExpand);
        }
        await selectWorkspace(workspaceId, {
          force: true,
          preservePending: true,
          latencyFlowId: args.latencyFlowId,
        });
        logLatency("workspace.cloud_create.awaiting_ready", {
          attemptId,
          workspaceId,
          status: workspace.status,
          attemptCount,
          retryCount,
        });
        return {
          status: "awaiting-ready",
          workspaceId,
          cloudWorkspaceId: workspace.id,
          attemptId,
        };
      } catch (error) {
        if (
          isCloudWorkspaceBranchConflictError(error)
          && !args.initialRequest
          && args.allowConflictRetry
          && attemptCount < maxAttempts
        ) {
          retryCount += 1;
          knownBranchNames.add(attempt.branchName);
          continue;
        }

        captureTelemetryException(error, {
          tags: {
            action: "create_cloud_workspace",
            domain: "cloud_workspace",
            workspace_kind: "cloud",
          },
          extras: {
            attemptCount,
            retryCount,
          },
        });
        const currentPending = useHarnessStore.getState().pendingWorkspaceEntry;
        failPendingEntry(
          currentPending?.attemptId === attemptId
            ? currentPending
            : currentEntry ?? nextEntry,
          resolveErrorMessage(error, "Failed to create cloud workspace."),
        );
        return { status: "interrupted" };
      }
    }
    return { status: "interrupted" };
  }, [
    authUser,
    beginPendingWorkspace,
    branchPrefixType,
    createCloudWorkspaceMutation,
    failPendingEntry,
    finalizeSelection,
    queryClient,
    runtimeUrl,
    selectWorkspace,
    setPendingWorkspaceEntry,
  ]);

  const createCloudWorkspaceAndEnter = useCallback(async (
    target: CloudWorkspaceRepoTarget,
    options?: CreateCloudWorkspaceAndEnterOptions,
  ) => {
    await runCloudWorkspaceCreateFlow({
      target,
      allowConflictRetry: true,
      repoGroupKeyToExpand: options?.repoGroupKeyToExpand,
      latencyFlowId: options?.latencyFlowId,
    });
  }, [runCloudWorkspaceCreateFlow]);

  const createCloudWorkspaceAndEnterWithResult = useCallback(async (
    target: CloudWorkspaceRepoTarget,
    options?: CreateCloudWorkspaceAndEnterOptions,
  ): Promise<CloudWorkspaceEntryResult> => {
    return runCloudWorkspaceCreateFlow({
      target,
      allowConflictRetry: true,
      repoGroupKeyToExpand: options?.repoGroupKeyToExpand,
      latencyFlowId: options?.latencyFlowId,
    });
  }, [runCloudWorkspaceCreateFlow]);

  const retryCloudWorkspaceAndEnter = useCallback(async (
    request: CreateCloudWorkspaceRequest,
  ) => {
    await runCloudWorkspaceCreateFlow({
      target: buildRepoTargetFromRequest(request),
      initialRequest: request,
      allowConflictRetry: true,
    });
  }, [runCloudWorkspaceCreateFlow]);

  return {
    createCloudWorkspaceAndEnter,
    createCloudWorkspaceAndEnterWithResult,
    retryCloudWorkspaceAndEnter,
    isCreatingCloudWorkspace: createMutation.isPending,
  };
}
