import type { QueryClient } from "@tanstack/react-query";
import type { WorkspaceCollections } from "@/lib/domain/workspaces/collections";

export function workspaceCollectionsScopeKey(runtimeUrl: string) {
  return ["workspaces", runtimeUrl] as const;
}

export function workspaceCollectionsKey(
  runtimeUrl: string,
  cloudAccessible: boolean,
) {
  return [...workspaceCollectionsScopeKey(runtimeUrl), cloudAccessible] as const;
}

export function getWorkspaceCollectionsFromCache(
  queryClient: QueryClient,
  runtimeUrl: string,
): WorkspaceCollections | undefined {
  const matchingQueries = queryClient.getQueryCache().findAll({
    queryKey: workspaceCollectionsScopeKey(runtimeUrl),
  });

  return matchingQueries
    .map((query) => ({
      data: query.state.data as WorkspaceCollections | undefined,
      dataUpdatedAt: query.state.dataUpdatedAt,
    }))
    .filter((entry): entry is { data: WorkspaceCollections; dataUpdatedAt: number } => (
      entry.data !== undefined
    ))
    .sort((left, right) => right.dataUpdatedAt - left.dataUpdatedAt)[0]
    ?.data;
}
