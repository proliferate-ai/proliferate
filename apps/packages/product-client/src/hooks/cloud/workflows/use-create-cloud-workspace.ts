import { useCallback, useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import type { CloudWorkspaceDetail, CreateCloudWorkspaceRequest } from "@proliferate/cloud-sdk/types";
import { createCloudWorkspace } from "@proliferate/cloud-sdk/client/workspaces";
import { cloudWorkspaceSyntheticId } from "#product/lib/domain/workspaces/cloud/cloud-ids";
import { resolveCloudWorkspaceStatus } from "#product/lib/domain/workspaces/cloud/cloud-workspace-status";
import {
  buildNextCloudWorkspaceAttempt,
  collectKnownCloudBranchNames,
  buildCloudWorkspaceAttemptFromRequest,
  type CloudWorkspaceRepoTarget,
  isCloudWorkspaceBranchConflictError,
  resolveCloudWorkspaceCreateFailureMessage,
} from "#product/lib/domain/workspaces/cloud/cloud-workspace-creation";
import {
  buildSubmittingPendingWorkspaceEntry,
  createPendingWorkspaceAttemptId,
  type PendingWorkspaceEntry,
  type PendingWorkspaceInitialSession,
} from "#product/lib/domain/workspaces/creation/pending-entry";
import { useCloudWorkspaceConnectionCache } from "#product/hooks/access/cloud/use-cloud-workspace-connection-cache";
import { useInvalidateCloudBillingState } from "#product/hooks/access/cloud/use-cloud-billing";
import { useWorkspaceSelection } from "#product/hooks/workspaces/workflows/selection/use-workspace-selection";
import { useWorkspaceEntryFlow } from "#product/hooks/workspaces/workflows/use-workspace-entry-flow";
import {
  getPendingWorkspaceEntry,
  isAttemptAttended,
  isAttemptLive,
} from "#product/hooks/workspaces/workflows/pending-workspace-attempt-access";
import { useHarnessConnectionStore } from "#product/stores/sessions/harness-connection-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { ensureRepoGroupExpanded } from "#product/stores/preferences/workspace-ui-store";
import { useUserPreferencesStore } from "#product/stores/preferences/user-preferences-store";
import type { AuthUser } from "#product/lib/domain/auth/auth-user";
import { useProductAuthUser } from "#product/hooks/auth/facade/use-product-auth";
import { useWorkspaceCollectionsCache } from "#product/hooks/workspaces/cache/use-workspace-collections-cache";
import { useWorkspaceCollectionsMutationCache } from "#product/hooks/workspaces/cache/use-workspace-collections-mutation-cache";
import { useProductTelemetry } from "#product/hooks/telemetry/facade/use-product-telemetry";
import {
  elapsedMs,
  logLatency,
  startLatencyTimer,
} from "#product/lib/infra/measurement/measurement-port";

const MAX_CLOUD_CREATE_ATTEMPTS = 3;

interface CreateCloudWorkspaceAndEnterOptions {
  repoGroupKeyToExpand?: string | null;
  latencyFlowId?: string | null;
  initialSession?: PendingWorkspaceInitialSession | null;
  /**
   * A caller that has to name this attempt before it exists (Home, which scopes
   * its launch intent to it) mints the id and passes it in; everyone else lets
   * the flow mint its own.
   */
  attemptId?: string | null;
}

export type CloudWorkspaceEntryResult =
  | {
    status: "ready";
    workspaceId: string;
    cloudWorkspaceId: string;
    attemptId: string;
    projectedSessionId: string | null;
  }
  | {
    status: "awaiting-ready";
    workspaceId: string;
    cloudWorkspaceId: string;
    attemptId: string;
    projectedSessionId: string | null;
  }
  | {
    status: "interrupted";
    // Set only when the attempt failed with a server error (vs. being
    // superseded by a newer attempt); carries the resolved server message so
    // callers can surface it in a toast instead of a generic string.
    failureMessage?: string;
  }
  // The user dismissed the pending workspace: nothing failed, so callers stop
  // quietly instead of reporting an interruption.
  | { status: "dismissed" };

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
  const telemetry = useProductTelemetry();
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const setPendingWorkspaceEntry = useSessionSelectionStore((state) => state.setPendingWorkspaceEntry);
  const branchPrefixType = useUserPreferencesStore((state) => state.branchPrefixType);
  // Only the branch prefix (github login) is consumed downstream, so the
  // normalized host user maps losslessly onto the AuthUser shape the domain
  // helpers expect. Memoized on the stable host user so the create callback
  // keeps its identity across unrelated renders.
  const hostAuthUser = useProductAuthUser();
  const authUser = useMemo<AuthUser | null>(
    () =>
      hostAuthUser
        ? {
            id: hostAuthUser.id,
            email: hostAuthUser.email ?? "",
            display_name: hostAuthUser.displayName ?? null,
            github_login: hostAuthUser.githubLogin ?? null,
            avatar_url: hostAuthUser.avatarUrl ?? null,
          }
        : null,
    [hostAuthUser],
  );
  const { selectWorkspace } = useWorkspaceSelection();
  const { beginPendingWorkspace, failPendingEntry, finalizeSelection } = useWorkspaceEntryFlow();
  const invalidateCloudBillingState = useInvalidateCloudBillingState();
  const { clearCachedCloudWorkspaceConnections } = useCloudWorkspaceConnectionCache();
  const { getWorkspaceCollections } = useWorkspaceCollectionsCache({
    runtimeUrl,
    cloudActive: true,
    authUserId: authUser?.id ?? null,
  });
  const { upsertCloudWorkspace } = useWorkspaceCollectionsMutationCache(runtimeUrl);

  const createMutation = useMutation<CloudWorkspaceDetail, Error, Parameters<typeof createCloudWorkspace>[0]>({
    meta: {
      telemetryHandled: true,
    },
    mutationFn: async (input) => {
      return createCloudWorkspace(input);
    },
    onSuccess: async (workspace) => {
      await clearCachedCloudWorkspaceConnections(workspace.id);
      upsertCloudWorkspace(workspace);
      await invalidateCloudBillingState();
    },
  });
  const { mutateAsync: createCloudWorkspaceMutation } = createMutation;

  const runCloudWorkspaceCreateFlow = useCallback(async (args: {
    target: CloudWorkspaceRepoTarget;
    initialRequest?: CreateCloudWorkspaceRequest;
    allowConflictRetry: boolean;
    repoGroupKeyToExpand?: string | null;
    latencyFlowId?: string | null;
    initialSession?: PendingWorkspaceInitialSession | null;
    attemptId?: string | null;
  }): Promise<CloudWorkspaceEntryResult> => {
    const startedAt = startLatencyTimer();
    const repoLabel = `${args.target.gitOwner}/${args.target.gitRepoName}`;
    const attemptId = args.attemptId ?? createPendingWorkspaceAttemptId();
    const cloudWorkspaces = getWorkspaceCollections()?.cloudWorkspaces ?? [];
    const knownBranchNames = collectKnownCloudBranchNames({
      target: args.target,
      cloudWorkspaces,
    });

    let triedBranchNames = new Set<string>(
      args.initialRequest ? [args.initialRequest.branchName] : [],
    );
    let currentEntry: PendingWorkspaceEntry | null = null;
    let projectedSessionId: string | null = null;
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
        selectedWorkspaceId: useSessionSelectionStore.getState().selectedWorkspaceId,
        source: "cloud-created",
        displayName: attempt.request.displayName ?? attempt.branchName,
        repoLabel,
        baseBranchName: attempt.request.baseBranch ?? null,
        request: {
          kind: "cloud",
          input: {
            ...attempt.request,
            generatedName: attempt.request.generatedName ?? false,
          },
        },
      });

      if (currentEntry === null) {
        projectedSessionId = beginPendingWorkspace(nextEntry, { initialSession: args.initialSession });
      } else if (isAttemptLive(attemptId)) {
        setPendingWorkspaceEntry(nextEntry);
      } else {
        return { status: "dismissed" };
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
        const workspaceStatus = resolveCloudWorkspaceStatus(workspace) ?? "pending";
        telemetry.track("cloud_workspace_created", {
          workspace_kind: "cloud",
          status: workspaceStatus,
          // Workspace creation is repository-only; scratch workspaces never
          // come from this flow, but the payload type is placement-neutral.
          git_provider: workspace.repo?.provider ?? "github",
          attempt_count: attemptCount,
          retry_count: retryCount,
        });
        logLatency("workspace.cloud_create.request.success", {
          attemptId,
          workspaceId: workspace.id,
          status: workspaceStatus,
          attemptCount,
          retryCount,
          requestElapsedMs: elapsedMs(requestStartedAt),
          totalElapsedMs: elapsedMs(startedAt),
        });
        if (!isAttemptLive(attemptId)) {
          return { status: "dismissed" };
        }

        const workspaceId = cloudWorkspaceSyntheticId(workspace.id);
        const updatedEntry: PendingWorkspaceEntry = {
          ...nextEntry,
          stage: workspaceStatus === "ready" ? "submitting" : "awaiting-cloud-ready",
          workspaceId,
          baseBranchName: workspace.repo?.baseBranch ?? null,
          request: { kind: "select-existing", workspaceId },
        };
        setPendingWorkspaceEntry(updatedEntry);

        if (workspaceStatus === "ready") {
          // `committed` without `selected` is a background completion: the user
          // switched away mid-create and the launch finished behind them.
          const selection = await finalizeSelection(updatedEntry, workspaceId, {
            latencyFlowId: args.latencyFlowId,
            repoGroupKeyToExpand: args.repoGroupKeyToExpand,
          });
          if (!selection.committed) {
            return { status: "dismissed" };
          }
          return {
            status: "ready",
            workspaceId,
            cloudWorkspaceId: workspace.id,
            attemptId,
            projectedSessionId,
          };
        }

        if (args.repoGroupKeyToExpand) {
          ensureRepoGroupExpanded(args.repoGroupKeyToExpand);
        }
        if (isAttemptAttended(attemptId)) {
          await selectWorkspace(workspaceId, {
            force: true,
            preservePending: true,
            initialActiveSessionId: projectedSessionId,
            latencyFlowId: args.latencyFlowId,
          });
        }
        logLatency("workspace.cloud_create.awaiting_ready", {
          attemptId,
          workspaceId,
          status: workspaceStatus,
          attemptCount,
          retryCount,
        });
        return {
          status: "awaiting-ready",
          workspaceId,
          cloudWorkspaceId: workspace.id,
          attemptId,
          projectedSessionId,
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

        telemetry.captureException(error, {
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
        const failureMessage = resolveCloudWorkspaceCreateFailureMessage(
          error,
          "Failed to create cloud workspace.",
        );
        failPendingEntry(
          getPendingWorkspaceEntry(attemptId) ?? currentEntry ?? nextEntry,
          failureMessage,
        );
        return { status: "interrupted", failureMessage };
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
    getWorkspaceCollections,
    selectWorkspace,
    setPendingWorkspaceEntry,
    telemetry,
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
      initialSession: options?.initialSession,
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
      initialSession: options?.initialSession,
      attemptId: options?.attemptId,
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
