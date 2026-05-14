import { useQuery } from "@tanstack/react-query";
import {
  getWorkspaceSnapshot,
  type CloudWorkspaceSnapshot,
} from "@proliferate/cloud-sdk";
import { cloudWorkspaceSnapshotKey } from "../lib/query-keys.js";
import { useCloudClient } from "../context/CloudClientProvider.js";

export function useCloudWorkspaceSnapshot(workspaceId: string | null, enabled = true) {
  const client = useCloudClient();
  return useQuery<CloudWorkspaceSnapshot>({
    queryKey: cloudWorkspaceSnapshotKey(workspaceId),
    queryFn: () => getWorkspaceSnapshot(workspaceId!, client),
    enabled: enabled && workspaceId !== null,
  });
}
