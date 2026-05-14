import { useQuery } from "@tanstack/react-query";
import {
  getWorkspaceSnapshot,
  type CloudWorkspaceSnapshot,
} from "@proliferate/cloud-sdk";
import { cloudWorkspaceSnapshotKey } from "../lib/query-keys";

export function useCloudWorkspaceSnapshot(workspaceId: string | null, enabled = true) {
  return useQuery<CloudWorkspaceSnapshot>({
    queryKey: cloudWorkspaceSnapshotKey(workspaceId),
    queryFn: () => getWorkspaceSnapshot(workspaceId!),
    enabled: enabled && workspaceId !== null,
  });
}

