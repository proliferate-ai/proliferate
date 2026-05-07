import type { QueryClient } from "@tanstack/react-query";
import {
  cloudWorkspaceConnectionKey,
  isCloudWorkspaceConnectionQueryKey,
} from "@/hooks/access/cloud/query-keys";

export async function clearCachedCloudConnections(
  queryClient: QueryClient,
  workspaceId?: string,
): Promise<void> {
  if (workspaceId) {
    const filters = {
      queryKey: cloudWorkspaceConnectionKey(workspaceId),
      exact: true as const,
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
