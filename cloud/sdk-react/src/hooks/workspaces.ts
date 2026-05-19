import { useQuery } from "@tanstack/react-query";
import {
  listCloudWorkspaces,
  getWorkspaceSnapshot,
  type CloudWorkspaceSummary,
  type CloudWorkspaceSnapshot,
} from "@proliferate/cloud-sdk";
import {
  cloudWorkspacesKey,
  cloudWorkspaceSnapshotKey,
} from "../lib/query-keys.js";
import { useCloudClient } from "../context/CloudClientProvider.js";

export function useCloudWorkspaces(enabled = true) {
  const client = useCloudClient();
  return useQuery<CloudWorkspaceSummary[]>({
    queryKey: cloudWorkspacesKey(),
    queryFn: () => listCloudWorkspaces(undefined, undefined, client),
    enabled,
  });
}

export function useCloudWorkspaceSnapshot(workspaceId: string | null, enabled = true) {
  const client = useCloudClient();
  return useQuery<CloudWorkspaceSnapshot>({
    queryKey: cloudWorkspaceSnapshotKey(workspaceId),
    queryFn: () => getWorkspaceSnapshot(workspaceId!, client),
    enabled: enabled && workspaceId !== null,
  });
}
