import { useMutation } from "@tanstack/react-query";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import {
  type CreateWorktreeWorkspaceResponse,
  type RepoRoot,
  type ResolveWorkspaceResponse,
  type Workspace,
} from "@anyharness/sdk";
import { useWorkspaceCollectionsInvalidationActions } from "@/hooks/workspaces/cache/use-workspace-collections-invalidation";
import { useWorkspaceCollectionsMutationCacheActions } from "@/hooks/workspaces/cache/use-workspace-collections-mutation-cache";
import { useRepoPreferencesStore } from "@/stores/preferences/repo-preferences-store";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";
import { getHomeDir } from "@/lib/access/tauri/shell";
import {
  createWorkspace,
  createWorktreeWorkspace,
} from "@/lib/access/anyharness/workspaces";
import {
  collectWorktreeBasenamesForRepo,
  generateWorkspaceSlug,
} from "@/lib/domain/workspaces/creation/workspace-slug";
import { useWorkspaces } from "@/hooks/workspaces/cache/use-workspaces";
import { isCloudWorkspaceId } from "@/lib/domain/workspaces/cloud/cloud-ids";
import {
  captureTelemetryException,
  trackProductEvent,
} from "@/lib/integrations/telemetry/client";
import type { SetupScriptTelemetryStatus } from "@/lib/domain/telemetry/events";
import { useAuthStore } from "@/stores/auth/auth-store";
import {
  type CreateWorktreeWorkspaceInput,
  type ResolvedWorktreeCreation,
  type WorktreeCreationParams,
  resolveWorktreeCreationParams,
} from "@/lib/domain/workspaces/creation/workspace-creation";
import { ensureRuntimeReady } from "./runtime-ready";
import { DESKTOP_ORIGIN } from "@/lib/domain/sessions/desktop-origin";
import {
  elapsedMs,
  logLatency,
  startLatencyTimer,
} from "@/lib/infra/measurement/debug-latency";
import { getLatencyFlowRequestHeaders } from "@/lib/infra/measurement/latency-flow";

interface CreateWorktreeMutationInput {
  params: WorktreeCreationParams;
  latencyFlowId?: string | null;
}

interface RuntimeBoundResult<T> {
  result: T;
  runtimeUrl: string;
}

export function useWorkspaceActions() {
  const localRuntime = useProductHost().desktop?.runtime ?? null;
  const {
    upsertLocalWorkspaceInWorkspaceCollections,
  } = useWorkspaceCollectionsMutationCacheActions();
  const {
    invalidateWorkspaceCollectionsForRuntime,
  } = useWorkspaceCollectionsInvalidationActions();
  const { data: workspaceCollections } = useWorkspaces();
  const primeWorkspaceCollections = (
    runtimeUrl: string,
    workspace: Workspace,
    source: "local_create" | "worktree_create",
    repoRoot?: RepoRoot | null,
  ) => {
    const startedAt = startLatencyTimer();
    const summary = upsertLocalWorkspaceInWorkspaceCollections(
      runtimeUrl,
      workspace,
      repoRoot,
    );

    logLatency("workspace.collections.cache_upsert", {
      source,
      workspaceId: workspace.id,
      workspaceKind: workspace.kind,
      alreadyPresent: summary.alreadyPresent,
      previousLocalCount: summary.previousLocalCount,
      nextLocalCount: summary.nextLocalCount,
      elapsedMs: elapsedMs(startedAt),
    });
  };

  const refreshWorkspaceCollections = (
    runtimeUrl: string,
    source: "local_create" | "worktree_create",
    workspaceId: string,
  ) => {
    const startedAt = startLatencyTimer();
    logLatency("workspace.collections.invalidate.start", {
      source,
      workspaceId,
      runtimeUrl,
    });
    void invalidateWorkspaceCollectionsForRuntime(runtimeUrl).then(() => {
      logLatency("workspace.collections.invalidate.success", {
        source,
        workspaceId,
        runtimeUrl,
        elapsedMs: elapsedMs(startedAt),
      });
    });
  };

  const createLocalWorkspaceMutation = useMutation<
    RuntimeBoundResult<ResolveWorkspaceResponse>,
    Error,
    string
  >({
    meta: {
      telemetryHandled: true,
    },
    mutationFn: async (sourceRoot) => {
      const readyRuntimeUrl = await ensureRuntimeReady(localRuntime);
      const connection = { runtimeUrl: readyRuntimeUrl };
      const request = {
        path: sourceRoot,
        origin: DESKTOP_ORIGIN,
      };

      return {
        result: await createWorkspace(connection, request),
        runtimeUrl: readyRuntimeUrl,
      };
    },
    onSuccess: ({ result, runtimeUrl }) => {
      primeWorkspaceCollections(
        runtimeUrl,
        result.workspace,
        "local_create",
        result.repoRoot,
      );
      refreshWorkspaceCollections(runtimeUrl, "local_create", result.workspace.id);
      trackProductEvent("workspace_created", {
        workspace_kind: "local",
        creation_kind: "local",
      });
    },
    onError: (error) => {
      captureTelemetryException(error, {
        tags: {
          action: "create_local_workspace",
          domain: "workspace",
          workspace_kind: "local",
        },
      });
    },
  });

  const createWorktreeMutation = useMutation<
    RuntimeBoundResult<CreateWorktreeWorkspaceResponse>,
    Error,
    CreateWorktreeMutationInput
  >({
    meta: {
      telemetryHandled: true,
    },
    mutationFn: async ({ params, latencyFlowId }) => {
      const readyRuntimeUrl = await ensureRuntimeReady(localRuntime);
      return {
        result: await createWorktreeWorkspace({ runtimeUrl: readyRuntimeUrl }, {
          repoRootId: params.repoRootId,
          targetPath: params.targetPath,
          newBranchName: params.branchName,
          baseBranch: params.baseRef || undefined,
          checkoutMode: params.checkoutMode,
          setupScript: params.setupScript?.trim() || undefined,
          nameConflictPolicy: params.nameConflictPolicy,
          origin: DESKTOP_ORIGIN,
        }, latencyFlowId
          ? { headers: getLatencyFlowRequestHeaders(latencyFlowId) }
          : undefined),
        runtimeUrl: readyRuntimeUrl,
      };
    },
    onSuccess: ({ result, runtimeUrl }) => {
      primeWorkspaceCollections(runtimeUrl, result.workspace, "worktree_create");
      refreshWorkspaceCollections(runtimeUrl, "worktree_create", result.workspace.id);
      trackProductEvent("workspace_created", {
        workspace_kind: "local",
        creation_kind: "worktree",
        setup_script_status: (
          result.setupScript?.status === "succeeded" || result.setupScript?.status === "failed"
            ? result.setupScript.status
            : "not_run"
        ) as SetupScriptTelemetryStatus,
      });
    },
    onError: (error) => {
      captureTelemetryException(error, {
        tags: {
          action: "create_worktree_workspace",
          domain: "workspace",
          workspace_kind: "local",
        },
      });
    },
  });

  return {
    resolveWorktreeCreationInput: async (
      input: CreateWorktreeWorkspaceInput,
    ): Promise<ResolvedWorktreeCreation> => {
      if (input.sourceWorkspaceId && isCloudWorkspaceId(input.sourceWorkspaceId)) {
        throw new Error("Branch workspaces can only be created from local repositories.");
      }

      const repoRoot = workspaceCollections?.repoRoots.find(
        (candidate) => candidate.id === input.repoRootId,
      ) ?? null;
      if (!repoRoot) {
        throw new Error("Repository root not found.");
      }

      const sourceWorkspace = input.sourceWorkspaceId
        ? workspaceCollections?.localWorkspaces.find((workspace) =>
          workspace.id === input.sourceWorkspaceId
          && workspace.repoRootId === input.repoRootId
          && (workspace.kind === "local" || workspace.kind === "worktree")
        ) ?? null
        : workspaceCollections?.localWorkspaces.find((workspace) =>
          workspace.repoRootId === input.repoRootId && workspace.kind === "local"
        ) ?? workspaceCollections?.localWorkspaces.find((workspace) =>
          workspace.repoRootId === input.repoRootId && workspace.kind === "worktree"
        ) ?? null;

      const homeDir = await getHomeDir();
      const userPreferences = useUserPreferencesStore.getState();
      const authUser = useAuthStore.getState().user;
      const repoPreferences = useRepoPreferencesStore.getState();

      const existingWorktreeBasenames = sourceWorkspace
        ? collectWorktreeBasenamesForRepo(
          workspaceCollections?.localWorkspaces ?? [],
          sourceWorkspace,
        )
        : new Set(
          (workspaceCollections?.localWorkspaces ?? [])
            .filter((workspace) =>
              workspace.kind === "worktree" && workspace.repoRootId === input.repoRootId
            )
            .map((workspace) => workspace.path.split("/").filter(Boolean).pop())
            .filter((basename): basename is string => Boolean(basename)),
        );
      const explicitWorkspaceName = input.workspaceName?.trim();

      return resolveWorktreeCreationParams({
        repoRoot,
        sourceWorkspace,
        rawInput: {
          ...input,
          workspaceName: explicitWorkspaceName || generateWorkspaceSlug(existingWorktreeBasenames),
          generatedName: Boolean(input.generatedName || !explicitWorkspaceName),
        },
        homeDir,
        branchPrefixType: userPreferences.branchPrefixType,
        authUser,
        repoConfig: repoPreferences.repoConfigs[repoRoot.path] ?? null,
      });
    },
    createLocalWorkspace: async (sourceRoot: string) => {
      const { result } = await createLocalWorkspaceMutation.mutateAsync(sourceRoot);
      return result.workspace;
    },
    isCreatingLocalWorkspace: createLocalWorkspaceMutation.isPending,
    createWorktreeWorkspace: (
      params: WorktreeCreationParams,
      options?: { latencyFlowId?: string | null },
    ) => createWorktreeMutation.mutateAsync({
      params,
      latencyFlowId: options?.latencyFlowId,
    }).then(({ result }) => result),
    isCreatingWorktreeWorkspace: createWorktreeMutation.isPending,
  };
}
