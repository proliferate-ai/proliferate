import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  anyHarnessWorkspaceFileSearchKey,
  anyHarnessWorkspaceFileStatKey,
  getAnyHarnessClient,
  resolveWorkspaceConnectionFromContext,
  useAnyHarnessCacheScopeKey,
  useAnyHarnessWorkspaceContext,
} from "@anyharness/sdk-react";

const FUZZY_SEARCH_LIMIT = 200;

/** Imperative, cache-owned runtime file lookup used by bounded reference recovery. */
export function useWorkspaceFileLookup() {
  const queryClient = useQueryClient();
  const workspace = useAnyHarnessWorkspaceContext();
  const cacheScopeKey = useAnyHarnessCacheScopeKey();

  const searchFiles = useCallback(async ({
    materializedWorkspaceId,
    query,
  }: {
    materializedWorkspaceId: string;
    query: string;
  }) => queryClient.fetchQuery({
    queryKey: anyHarnessWorkspaceFileSearchKey(
      cacheScopeKey,
      materializedWorkspaceId,
      query,
      FUZZY_SEARCH_LIMIT,
    ),
    retry: false,
    queryFn: async () => {
      const { connection } = await resolveWorkspaceConnectionFromContext(
        workspace,
        materializedWorkspaceId,
      );
      return getAnyHarnessClient(connection).files.search(
        connection.anyharnessWorkspaceId,
        query,
        FUZZY_SEARCH_LIMIT,
      );
    },
  }), [cacheScopeKey, queryClient, workspace]);

  const statFile = useCallback(async ({
    materializedWorkspaceId,
    path,
  }: {
    materializedWorkspaceId: string;
    path: string;
  }) => queryClient.fetchQuery({
    queryKey: anyHarnessWorkspaceFileStatKey(cacheScopeKey, materializedWorkspaceId, path),
    retry: false,
    queryFn: async () => {
      const { connection } = await resolveWorkspaceConnectionFromContext(
        workspace,
        materializedWorkspaceId,
      );
      return getAnyHarnessClient(connection).files.stat(
        connection.anyharnessWorkspaceId,
        path,
      );
    },
  }), [cacheScopeKey, queryClient, workspace]);

  return { searchFiles, statFile };
}
