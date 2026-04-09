import { getAnyHarnessClient } from "@anyharness/sdk-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CreateWorktreeWorkspaceResponse, Workspace } from "@anyharness/sdk";
import { workspaceCollectionsScopeKey } from "./query-keys";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useRepoPreferencesStore } from "@/stores/preferences/repo-preferences-store";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";
import { getHomeDir } from "@/platform/tauri/shell";
import {
  collectWorktreeBasenamesForRepo,
  generateWorkspaceSlug,
} from "@/lib/domain/workspaces/arrival";
import { useWorkspaces } from "./use-workspaces";
import { isCloudWorkspaceId } from "@/lib/domain/workspaces/cloud-ids";
import {
  type WorkspaceCollections,
  upsertLocalWorkspaceCollections,
} from "@/lib/domain/workspaces/collections";
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
} from "@/lib/domain/workspaces/workspace-creation";
import { ensureRuntimeReady } from "./runtime-ready";
import {
  elapsedMs,
  logLatency,
  startLatencyTimer,
} from "@/lib/infra/debug-latency";
import { getLatencyFlowRequestHeaders } from "@/lib/infra/latency-flow";

interface CreateWorktreeMutationInput {
  params: WorktreeCreationParams;
  latencyFlowId?: string | null;
}

export function useWorkspaceActions() {
  const queryClient = useQueryClient();
  const { data: workspaceCollections } = useWorkspaces();
  const primeWorkspaceCollections = (
    workspace: Workspace,
    source: "local_create" | "worktree_create",
  ) => {
    const runtimeUrl = useHarnessStore.getState().runtimeUrl;
    const startedAt = startLatencyTimer();
    let previousLocalCount = 0;
    let nextLocalCount = 0;
    let alreadyPresent = false;

    queryClient.setQueriesData<WorkspaceCollections | undefined>(
      { queryKey: workspaceCollectionsScopeKey(runtimeUrl) },
      (collections) => {
        previousLocalCount = collections?.localWorkspaces.length ?? 0;
        alreadyPresent = collections?.localWorkspaces.some(
          (existing) => existing.id === workspace.id,
        ) ?? false;
        const nextCollections = upsertLocalWorkspaceCollections(collections, workspace);
        nextLocalCount = nextCollections?.localWorkspaces.length ?? previousLocalCount;
        return nextCollections;
      },
    );

    logLatency("workspace.collections.cache_upsert", {
      source,
      workspaceId: workspace.id,
      workspaceKind: workspace.kind,
      alreadyPresent,
      previousLocalCount,
      nextLocalCount,
      elapsedMs: elapsedMs(startedAt),
    });
  };

  const refreshWorkspaceCollections = (
    source: "local_create" | "worktree_create",
    workspaceId: string,
  ) => {
    const runtimeUrl = useHarnessStore.getState().runtimeUrl;
    const startedAt = startLatencyTimer();
    logLatency("workspace.collections.invalidate.start", {
      source,
      workspaceId,
      runtimeUrl,
    });
    void queryClient.invalidateQueries({
      queryKey: workspaceCollectionsScopeKey(runtimeUrl),
    }).then(() => {
      logLatency("workspace.collections.invalidate.success", {
        source,
        workspaceId,
        runtimeUrl,
        elapsedMs: elapsedMs(startedAt),
      });
    });
  };

  const createLocalWorkspaceMutation = useMutation<Workspace, Error, string>({
    meta: {
      telemetryHandled: true,
    },
    mutationFn: async (sourceRoot) => {
      const readyRuntimeUrl = await ensureRuntimeReady();
      return getAnyHarnessClient({ runtimeUrl: readyRuntimeUrl }).workspaces.create({ path: sourceRoot });
    },
    onSuccess: (workspace) => {
      primeWorkspaceCollections(workspace, "local_create");
      refreshWorkspaceCollections("local_create", workspace.id);
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
    CreateWorktreeWorkspaceResponse,
    Error,
    CreateWorktreeMutationInput
  >({
    meta: {
      telemetryHandled: true,
    },
    mutationFn: async ({ params, latencyFlowId }) => {
      const readyRuntimeUrl = await ensureRuntimeReady();
      return getAnyHarnessClient({ runtimeUrl: readyRuntimeUrl }).workspaces.createWorktree({
        sourceWorkspaceId: params.sourceWorkspaceId,
        targetPath: params.targetPath,
        newBranchName: params.branchName,
        baseBranch: params.baseRef || undefined,
        setupScript: params.setupScript?.trim() || undefined,
      }, latencyFlowId
        ? { headers: getLatencyFlowRequestHeaders(latencyFlowId) }
        : undefined);
    },
    onSuccess: (result) => {
      primeWorkspaceCollections(result.workspace, "worktree_create");
      refreshWorkspaceCollections("worktree_create", result.workspace.id);
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
      if (isCloudWorkspaceId(input.sourceWorkspaceId)) {
        throw new Error("Branch workspaces can only be created from local repositories.");
      }

      const source = workspaceCollections?.workspaces.find(
        (workspace) => workspace.id === input.sourceWorkspaceId,
      );
      if (!source || (source.kind !== "repo" && source.kind !== "local")) {
        throw new Error("Source must be a repo or local workspace.");
      }

      const homeDir = await getHomeDir();
      const userPreferences = useUserPreferencesStore.getState();
      const authUser = useAuthStore.getState().user;
      const repoPreferences = useRepoPreferencesStore.getState();

      const existingWorktreeBasenames = collectWorktreeBasenamesForRepo(
        workspaceCollections?.workspaces ?? [],
        source,
      );

      return resolveWorktreeCreationParams({
        source,
        rawInput: {
          ...input,
          workspaceName: input.workspaceName?.trim() || generateWorkspaceSlug(existingWorktreeBasenames),
        },
        homeDir,
        branchPrefixType: userPreferences.branchPrefixType,
        authUser,
        repoConfig: repoPreferences.repoConfigs[source.sourceRepoRootPath] ?? null,
      });
    },
    createLocalWorkspace: createLocalWorkspaceMutation.mutateAsync,
    isCreatingLocalWorkspace: createLocalWorkspaceMutation.isPending,
    createWorktreeWorkspace: (
      params: WorktreeCreationParams,
      options?: { latencyFlowId?: string | null },
    ) => createWorktreeMutation.mutateAsync({
      params,
      latencyFlowId: options?.latencyFlowId,
    }),
    isCreatingWorktreeWorkspace: createWorktreeMutation.isPending,
  };
}
