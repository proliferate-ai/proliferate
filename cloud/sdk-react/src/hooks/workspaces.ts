import { useQuery } from "@tanstack/react-query";
import {
  listCloudWorkspaces,
  getWorkspaceSnapshot,
  type CloudWorkspaceSummary,
  type CloudWorkspaceSnapshot,
  type CloudWorkspaceListSelection,
  type CloudWorkspaceListScope,
} from "@proliferate/cloud-sdk";
import {
  cloudWorkspacesKey,
  cloudWorkspaceSnapshotKey,
  personalCloudOwnerKey,
  type CloudOwnerScope,
} from "../lib/query-keys.js";
import { useCloudClient } from "../context/CloudClientProvider.js";

export interface UseCloudWorkspacesOptions {
  enabled?: boolean;
  ownerScope?: CloudOwnerScope;
  organizationId?: string | null;
  scope?: CloudWorkspaceListScope | null;
}

export function useCloudWorkspaces(options: UseCloudWorkspacesOptions | boolean = {}) {
  const client = useCloudClient();
  const normalizedOptions = typeof options === "boolean" ? { enabled: options } : options;
  const owner = {
    ...personalCloudOwnerKey(),
    ownerScope: normalizedOptions.ownerScope ?? "personal",
    organizationId: normalizedOptions.organizationId ?? null,
  };
  const selection: CloudWorkspaceListSelection = {
    ownerScope: owner.ownerScope,
    organizationId: owner.organizationId,
    scope: normalizedOptions.scope ?? undefined,
  };
  return useQuery<CloudWorkspaceSummary[]>({
    queryKey: cloudWorkspacesKey(owner, normalizedOptions.scope ?? null),
    queryFn: () => listCloudWorkspaces(undefined, selection, client),
    enabled: normalizedOptions.enabled ?? true,
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
