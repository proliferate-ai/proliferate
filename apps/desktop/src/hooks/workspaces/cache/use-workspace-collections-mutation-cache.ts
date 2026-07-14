import type { RepoRoot, Workspace } from "@anyharness/sdk";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import type {
  CloudMobilityWorkspaceSummary,
  CloudWorkspaceDetail,
} from "@/lib/access/cloud/client";
import { cloudMobilityWorkspacesKey } from "@/hooks/access/cloud/query-keys";
import {
  buildWorkspaceCollections,
  type WorkspaceCollections,
  upsertCloudWorkspaceCollections,
  upsertLocalWorkspaceCollections,
  upsertRepoRootCollections,
} from "@/lib/domain/workspaces/cloud/collections";
import {
  getWorkspaceCollectionsFromCache,
  workspaceCollectionsKey,
  workspaceCollectionsScopeKey,
} from "@/hooks/workspaces/cache/query-keys";

export interface WorkspaceCollectionsLocalUpsertSummary {
  previousLocalCount: number;
  nextLocalCount: number;
  alreadyPresent: boolean;
}

function upsertLocalWorkspaceForRuntime(
  queryClient: QueryClient,
  runtimeUrl: string,
  workspace: Workspace,
  repoRoot?: RepoRoot | null,
): WorkspaceCollectionsLocalUpsertSummary {
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
      const nextCollections = upsertLocalWorkspaceCollections(collections, workspace, repoRoot);
      nextLocalCount = nextCollections?.localWorkspaces.length ?? previousLocalCount;
      return nextCollections;
    },
  );

  return {
    previousLocalCount,
    nextLocalCount,
    alreadyPresent,
  };
}

function upsertRepoRootForRuntime(
  queryClient: QueryClient,
  runtimeUrl: string,
  repoRoot: RepoRoot,
): void {
  queryClient.setQueriesData<WorkspaceCollections | undefined>(
    { queryKey: workspaceCollectionsScopeKey(runtimeUrl) },
    (collections) => upsertRepoRootCollections(collections, repoRoot),
  );
}

export function upsertCloudWorkspaceForRuntime(
  queryClient: QueryClient,
  runtimeUrl: string,
  workspace: CloudWorkspaceDetail,
  authUserId: string | null = null,
): void {
  const nextCollections = upsertCloudWorkspaceCollections(
    getWorkspaceCollectionsFromCache(queryClient, runtimeUrl, authUserId),
    workspace,
  ) ?? buildWorkspaceCollections([], [], [workspace]);

  queryClient.setQueryData(
    workspaceCollectionsKey(runtimeUrl, true, authUserId),
    nextCollections,
  );
}

export function useWorkspaceCollectionsMutationCache(runtimeUrl: string) {
  const queryClient = useQueryClient();
  const authState = useProductHost().auth.state;
  const authUserId = authState.status === "authenticated"
    ? authState.user?.id ?? null
    : null;

  const upsertLocalWorkspace = useCallback(
    (
      workspace: Workspace,
      repoRoot?: RepoRoot | null,
    ): WorkspaceCollectionsLocalUpsertSummary =>
      upsertLocalWorkspaceForRuntime(queryClient, runtimeUrl, workspace, repoRoot),
    [queryClient, runtimeUrl],
  );

  const upsertRepoRoot = useCallback((repoRoot: RepoRoot) => {
    upsertRepoRootForRuntime(queryClient, runtimeUrl, repoRoot);
  }, [queryClient, runtimeUrl]);

  const upsertCloudWorkspace = useCallback((workspace: CloudWorkspaceDetail) => {
    upsertCloudWorkspaceForRuntime(queryClient, runtimeUrl, workspace, authUserId);
    queryClient.setQueryData<CloudMobilityWorkspaceSummary[] | undefined>(
      cloudMobilityWorkspacesKey(),
      (workspaces) => workspaces?.map((candidate) => (
        candidate.cloudWorkspaceId === workspace.id
          ? {
            ...candidate,
            displayName: workspace.displayName,
            repo: {
              ...candidate.repo,
              branch: workspace.repo.branch,
            },
            updatedAt: workspace.updatedAt,
          }
          : candidate
      )),
    );
  }, [authUserId, queryClient, runtimeUrl]);

  return {
    upsertCloudWorkspace,
    upsertLocalWorkspace,
    upsertRepoRoot,
  };
}

export function useWorkspaceCollectionsMutationCacheActions() {
  const queryClient = useQueryClient();

  const upsertLocalWorkspaceInWorkspaceCollections = useCallback((
    runtimeUrl: string,
    workspace: Workspace,
    repoRoot?: RepoRoot | null,
  ): WorkspaceCollectionsLocalUpsertSummary =>
    upsertLocalWorkspaceForRuntime(queryClient, runtimeUrl, workspace, repoRoot),
  [queryClient]);

  const upsertRepoRootInWorkspaceCollections = useCallback((
    runtimeUrl: string,
    repoRoot: RepoRoot,
  ) => {
    upsertRepoRootForRuntime(queryClient, runtimeUrl, repoRoot);
  }, [queryClient]);

  return {
    upsertLocalWorkspaceInWorkspaceCollections,
    upsertRepoRootInWorkspaceCollections,
  };
}
