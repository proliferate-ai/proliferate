import type { QueryClient } from "@tanstack/react-query";
import {
  isCloudWorkspaceConnectionQueryKey,
} from "@/hooks/access/cloud/query-keys";

export async function clearCachedCloudConnections(
  queryClient: QueryClient,
  workspaceId?: string,
): Promise<void> {
  if (workspaceId) {
    const filters = {
      predicate: (query: { queryKey: readonly unknown[] }) =>
        isCloudWorkspaceConnectionQueryKey(query.queryKey)
        && query.queryKey[2] === workspaceId,
    };
    await queryClient.cancelQueries(filters);
    queryClient.removeQueries(filters);
    return;
  }

  const filters = {
    predicate: (query: { queryKey: readonly unknown[] }) => {
      return isCloudWorkspaceConnectionQueryKey(query.queryKey);
    },
  };
  await queryClient.cancelQueries(filters);
  queryClient.removeQueries(filters);
}
