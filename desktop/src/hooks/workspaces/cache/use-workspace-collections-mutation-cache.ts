import type { RepoRoot, Workspace } from "@anyharness/sdk";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type {
  CloudMobilityWorkspaceSummary,
  CloudWorkspaceDetail,
} from "@/lib/access/cloud/client";
import { cloudMobilityWorkspacesKey } from "@/hooks/access/cloud/query-keys";
import {
  type WorkspaceCollections,
  upsertCloudWorkspaceCollections,
  upsertLocalWorkspaceCollections,
  upsertRepoRootCollections,
} from "@/lib/domain/workspaces/cloud/collections";
import { workspaceCollectionsScopeKey } from "@/hooks/workspaces/cache/query-keys";

export interface WorkspaceCollectionsLocalUpsertSummary {
  previousLocalCount: number;
  nextLocalCount: number;
  alreadyPresent: boolean;
}

function upsertLocalWorkspaceForRuntime(
  queryClient: QueryClient,
  runtimeUrl: string,
  workspace: Workspace,
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
      const nextCollections = upsertLocalWorkspaceCollections(collections, workspace);
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

export function useWorkspaceCollectionsMutationCache(runtimeUrl: string) {
  const queryClient = useQueryClient();

  const upsertLocalWorkspace = useCallback(
    (workspace: Workspace): WorkspaceCollectionsLocalUpsertSummary =>
      upsertLocalWorkspaceForRuntime(queryClient, runtimeUrl, workspace),
    [queryClient, runtimeUrl],
  );

  const upsertRepoRoot = useCallback((repoRoot: RepoRoot) => {
    upsertRepoRootForRuntime(queryClient, runtimeUrl, repoRoot);
  }, [queryClient, runtimeUrl]);

  const upsertCloudWorkspace = useCallback((workspace: CloudWorkspaceDetail) => {
    queryClient.setQueriesData<WorkspaceCollections | undefined>(
      { queryKey: workspaceCollectionsScopeKey(runtimeUrl) },
      (collections) => upsertCloudWorkspaceCollections(collections, workspace),
    );
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
  }, [queryClient, runtimeUrl]);

  return {
    upsertCloudWorkspace,
    upsertLocalWorkspace,
    upsertRepoRoot,
  };
}

export function useWorkspaceCollectionsMutationCacheActions() {
  const queryClient = useQueryClient();

  const upsertRepoRootInWorkspaceCollections = useCallback((
    runtimeUrl: string,
    repoRoot: RepoRoot,
  ) => {
    upsertRepoRootForRuntime(queryClient, runtimeUrl, repoRoot);
  }, [queryClient]);

  return {
    upsertRepoRootInWorkspaceCollections,
  };
}
