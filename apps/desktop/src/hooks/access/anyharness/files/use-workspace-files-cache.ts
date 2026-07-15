import { useQueryClient } from "@tanstack/react-query";
import {
  type AnyHarnessClientConnection,
  anyHarnessWorkspaceFileKey,
  anyHarnessWorkspaceFileSearchScopeKey,
  anyHarnessWorkspaceFileTreeKey,
  anyHarnessWorkspaceFilesScopeKey,
  useAnyHarnessCacheScopeKey,
} from "@anyharness/sdk-react";
import { useCallback } from "react";
import {
  listWorkspaceFiles,
  readWorkspaceFile,
} from "@/lib/access/anyharness/workspace-file-transport";

function buildConnection(
  runtimeUrl: string,
  authToken?: string | null,
): AnyHarnessClientConnection {
  return {
    runtimeUrl,
    authToken: authToken ?? undefined,
  };
}

interface WorkspaceFileCacheTarget {
  materializedWorkspaceId: string;
  anyharnessWorkspaceId: string;
  runtimeUrl: string;
  authToken?: string | null;
}

export function useWorkspaceFilesCache() {
  const queryClient = useQueryClient();
  const cacheScopeKey = useAnyHarnessCacheScopeKey();

  const invalidateWorkspaceFiles = useCallback(async ({
    workspaceId,
  }: {
    workspaceId: string;
  }) => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: anyHarnessWorkspaceFilesScopeKey(cacheScopeKey, workspaceId),
      }),
      queryClient.invalidateQueries({
        queryKey: anyHarnessWorkspaceFileSearchScopeKey(cacheScopeKey, workspaceId),
      }),
    ]);
  }, [cacheScopeKey, queryClient]);

  const prefetchWorkspaceDirectory = useCallback(async ({
    materializedWorkspaceId,
    anyharnessWorkspaceId,
    runtimeUrl,
    authToken,
    dirPath,
  }: WorkspaceFileCacheTarget & {
    dirPath: string;
  }) => {
    await queryClient.prefetchQuery({
      queryKey: anyHarnessWorkspaceFileTreeKey(
        cacheScopeKey,
        materializedWorkspaceId,
        dirPath,
      ),
      queryFn: async ({ signal }) => {
        return listWorkspaceFiles(
          buildConnection(runtimeUrl, authToken),
          anyharnessWorkspaceId,
          dirPath,
          { signal },
        );
      },
    });
  }, [cacheScopeKey, queryClient]);

  const reloadWorkspaceFile = useCallback(async ({
    materializedWorkspaceId,
    anyharnessWorkspaceId,
    runtimeUrl,
    authToken,
    filePath,
  }: WorkspaceFileCacheTarget & {
    filePath: string;
  }) => {
    const queryKey = anyHarnessWorkspaceFileKey(
      cacheScopeKey,
      materializedWorkspaceId,
      filePath,
    );
    await queryClient.invalidateQueries({ queryKey, exact: true });
    return queryClient.fetchQuery({
      queryKey,
      queryFn: async ({ signal }) => {
        return readWorkspaceFile(
          buildConnection(runtimeUrl, authToken),
          anyharnessWorkspaceId,
          filePath,
          { signal },
        );
      },
      staleTime: 0,
    });
  }, [cacheScopeKey, queryClient]);

  return {
    invalidateWorkspaceFiles,
    prefetchWorkspaceDirectory,
    reloadWorkspaceFile,
  };
}
