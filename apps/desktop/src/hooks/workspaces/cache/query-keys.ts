import type { QueryClient } from "@tanstack/react-query";
import type { WorkspaceCollections } from "@/lib/domain/workspaces/cloud/collections";

export function workspaceCollectionsRootKey() {
  return ["workspaces"] as const;
}

export function workspaceCollectionsScopeKey(runtimeUrl: string) {
  return [...workspaceCollectionsRootKey(), runtimeUrl] as const;
}

function workspaceCollectionsUserScopeKey(
  runtimeUrl: string,
  authUserId: string | null,
) {
  return [...workspaceCollectionsScopeKey(runtimeUrl), authUserId] as const;
}

export function workspaceCollectionsKey(
  runtimeUrl: string,
  cloudAccessible: boolean,
  authUserId: string | null = null,
) {
  return [...workspaceCollectionsUserScopeKey(runtimeUrl, authUserId), cloudAccessible] as const;
}

export function getWorkspaceCollectionsFromCache(
  queryClient: QueryClient,
  runtimeUrl: string,
  authUserId: string | null = null,
): WorkspaceCollections | undefined {
  const matchingQueries = queryClient.getQueryCache().findAll({
    queryKey: workspaceCollectionsUserScopeKey(runtimeUrl, authUserId),
  });

  return matchingQueries
    .map((query) => ({
      data: query.state.data,
      dataUpdatedAt: query.state.dataUpdatedAt,
    }))
    .filter((entry): entry is { data: WorkspaceCollections; dataUpdatedAt: number } => (
      isWorkspaceCollections(entry.data)
    ))
    .sort((left, right) => right.dataUpdatedAt - left.dataUpdatedAt)[0]
    ?.data;
}

function isWorkspaceCollections(value: unknown): value is WorkspaceCollections {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<Record<keyof WorkspaceCollections, unknown>>;
  return Array.isArray(candidate.localWorkspaces)
    && Array.isArray(candidate.retiredLocalWorkspaces)
    && Array.isArray(candidate.repoRoots)
    && Array.isArray(candidate.cloudWorkspaces)
    && Array.isArray(candidate.workspaces)
    && Array.isArray(candidate.allWorkspaces)
    && Array.isArray(candidate.cleanupAttentionWorkspaces);
}
