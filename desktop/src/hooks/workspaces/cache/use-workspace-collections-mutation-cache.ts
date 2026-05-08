import type { Workspace } from "@anyharness/sdk";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { CloudWorkspaceDetail } from "@/lib/access/cloud/client";
import {
  type WorkspaceCollections,
  upsertCloudWorkspaceCollections,
  upsertLocalWorkspaceCollections,
} from "@/lib/domain/workspaces/cloud/collections";
import { workspaceCollectionsScopeKey } from "@/hooks/workspaces/query-keys";

export function useWorkspaceCollectionsMutationCache(runtimeUrl: string) {
  const queryClient = useQueryClient();

  const upsertLocalWorkspace = useCallback((workspace: Workspace) => {
    queryClient.setQueriesData<WorkspaceCollections | undefined>(
      { queryKey: workspaceCollectionsScopeKey(runtimeUrl) },
      (collections) => upsertLocalWorkspaceCollections(collections, workspace),
    );
  }, [queryClient, runtimeUrl]);

  const upsertCloudWorkspace = useCallback((workspace: CloudWorkspaceDetail) => {
    queryClient.setQueriesData<WorkspaceCollections | undefined>(
      { queryKey: workspaceCollectionsScopeKey(runtimeUrl) },
      (collections) => upsertCloudWorkspaceCollections(collections, workspace),
    );
  }, [queryClient, runtimeUrl]);

  return {
    upsertCloudWorkspace,
    upsertLocalWorkspace,
  };
}
