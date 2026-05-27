import { useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import {
  archiveCloudWorkspace,
  createCloudWorkspace,
  launchCloudWorkspaceOnTarget,
  listCloudWorkspaces,
  purgeCloudWorkspace,
  restoreCloudWorkspace,
  getWorkspaceSnapshot,
  type CloudWorkspaceSummary,
  type CloudWorkspaceDetail,
  type CloudWorkspaceSnapshot,
  type CloudWorkspaceListSelection,
  type CloudWorkspaceListScope,
  type CloudWorkspaceLifecycleFilter,
  type CreateCloudWorkspaceRequest,
  type LaunchCloudWorkspaceOnTargetRequest,
  type WorkspaceTargetLaunchResponse,
} from "@proliferate/cloud-sdk";
import {
  cloudRootKey,
  cloudWorkspacesListRootKey,
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
  lifecycle?: CloudWorkspaceLifecycleFilter | null;
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
    lifecycle: normalizedOptions.lifecycle ?? undefined,
  };
  return useQuery<CloudWorkspaceSummary[]>({
    queryKey: cloudWorkspacesKey(
      owner,
      normalizedOptions.scope ?? null,
      normalizedOptions.lifecycle ?? null,
    ),
    queryFn: () => listCloudWorkspaces(undefined, selection, client),
    enabled: normalizedOptions.enabled ?? true,
  });
}

export function useVisibleCloudWorkspaces(enabled = true) {
  const mine = useCloudWorkspaces({ enabled, scope: "my" });
  const exposed = useCloudWorkspaces({ enabled, scope: "exposed" });
  const data = useMemo(
    () => mergeCloudWorkspaces(mine.data ?? [], exposed.data ?? []),
    [mine.data, exposed.data],
  );

  return {
    data,
    mine,
    exposed,
    error: mine.error ?? exposed.error,
    dataUpdatedAt: Math.max(mine.dataUpdatedAt, exposed.dataUpdatedAt),
    isError: mine.isError || exposed.isError,
    isFetching: mine.isFetching || exposed.isFetching,
    isLoading: mine.isLoading || exposed.isLoading,
    refetch: async () => {
      await Promise.all([mine.refetch(), exposed.refetch()]);
    },
  };
}

export function invalidateCloudWorkspaceLists(queryClient: QueryClient) {
  void queryClient.invalidateQueries({
    queryKey: cloudWorkspacesListRootKey(),
  });
}

export function invalidateCloudWorkspaceLifecycleQueries(
  queryClient: QueryClient,
  workspaceId?: string | null,
) {
  invalidateCloudWorkspaceLists(queryClient);
  void queryClient.invalidateQueries({
    queryKey: [...cloudRootKey(), "workspaces"],
  });
  void queryClient.invalidateQueries({
    queryKey: [...cloudRootKey(), "commands"],
  });
  if (workspaceId) {
    void queryClient.invalidateQueries({
      queryKey: cloudWorkspaceSnapshotKey(workspaceId),
    });
  }
}

export function useCloudWorkspaceSnapshot(workspaceId: string | null, enabled = true) {
  const client = useCloudClient();
  return useQuery<CloudWorkspaceSnapshot>({
    queryKey: cloudWorkspaceSnapshotKey(workspaceId),
    queryFn: () => getWorkspaceSnapshot(workspaceId!, client),
    enabled: enabled && workspaceId !== null,
  });
}

export function useCreateCloudWorkspace(options?: {
  ownerScope?: CloudOwnerScope;
  organizationId?: string | null;
}) {
  const client = useCloudClient();
  const queryClient = useQueryClient();
  const owner = options
    ? {
      ...personalCloudOwnerKey(),
      ownerScope: options.ownerScope ?? "personal",
      organizationId: options.organizationId ?? null,
    }
    : undefined;
  return useMutation<CloudWorkspaceDetail, Error, CreateCloudWorkspaceRequest>({
    mutationFn: (input) => createCloudWorkspace(input, owner, client),
    onSuccess() {
      invalidateCloudWorkspaceLists(queryClient);
      void queryClient.invalidateQueries({
        queryKey: [...cloudRootKey(), "workspaces"],
      });
    },
  });
}

export function useArchiveCloudWorkspace() {
  const client = useCloudClient();
  const queryClient = useQueryClient();
  return useMutation<CloudWorkspaceDetail, Error, string>({
    mutationFn: (workspaceId) => archiveCloudWorkspace(workspaceId, client),
    onSuccess(_data, workspaceId) {
      invalidateCloudWorkspaceLifecycleQueries(queryClient, workspaceId);
    },
  });
}

export function useRestoreCloudWorkspace() {
  const client = useCloudClient();
  const queryClient = useQueryClient();
  return useMutation<CloudWorkspaceDetail, Error, string>({
    mutationFn: (workspaceId) => restoreCloudWorkspace(workspaceId, client),
    onSuccess(_data, workspaceId) {
      invalidateCloudWorkspaceLifecycleQueries(queryClient, workspaceId);
    },
  });
}

export function useLaunchCloudWorkspaceOnTarget() {
  const client = useCloudClient();
  const queryClient = useQueryClient();
  return useMutation<
    WorkspaceTargetLaunchResponse,
    Error,
    LaunchCloudWorkspaceOnTargetRequest
  >({
    mutationFn: (input) => launchCloudWorkspaceOnTarget(input, client),
    onSuccess(result) {
      invalidateCloudWorkspaceLists(queryClient);
      void queryClient.invalidateQueries({
        queryKey: [...cloudRootKey(), "workspaces"],
      });
      void queryClient.invalidateQueries({
        queryKey: cloudWorkspaceSnapshotKey(result.workspace.id),
      });
    },
  });
}

export function usePurgeCloudWorkspace() {
  const client = useCloudClient();
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (workspaceId) => purgeCloudWorkspace(workspaceId, client),
    onSuccess(_data, workspaceId) {
      invalidateCloudWorkspaceLifecycleQueries(queryClient, workspaceId);
    },
  });
}

function mergeCloudWorkspaces(
  mine: readonly CloudWorkspaceSummary[],
  exposed: readonly CloudWorkspaceSummary[],
): CloudWorkspaceSummary[] {
  const byId = new Map<string, CloudWorkspaceSummary>();
  for (const workspace of [...mine, ...exposed]) {
    const existing = byId.get(workspace.id);
    if (existing) {
      byId.set(workspace.id, mergeCloudWorkspaceSummary(existing, workspace));
    } else {
      byId.set(workspace.id, workspace);
    }
  }
  return [...byId.values()];
}

function workspaceCompletenessScore(workspace: CloudWorkspaceSummary): number {
  let score = 0;
  if (workspace.exposure) score += 4;
  if (workspace.lastSessionSummary) score += 4;
  if (workspace.runtime) score += 2;
  if (workspace.lastActivityAt) score += 1;
  if (workspace.actionBlockKind || workspace.actionBlockReason) score += 1;
  if (workspace.lastError) score += 1;
  return score;
}

function mergeCloudWorkspaceSummary(
  existing: CloudWorkspaceSummary,
  incoming: CloudWorkspaceSummary,
): CloudWorkspaceSummary {
  const primary = workspaceCompletenessScore(incoming) >= workspaceCompletenessScore(existing)
    ? incoming
    : existing;
  const secondary = primary === incoming ? existing : incoming;
  return {
    ...secondary,
    ...primary,
    origin: primary.origin ?? secondary.origin,
    creatorContext: primary.creatorContext ?? secondary.creatorContext,
    directTargetContext: primary.directTargetContext ?? secondary.directTargetContext,
    executionTarget: primary.executionTarget ?? secondary.executionTarget,
    exposure: primary.exposure ?? secondary.exposure,
    exposureState: primary.exposureState ?? secondary.exposureState,
    cloudAccess: primary.cloudAccess ?? secondary.cloudAccess,
    lastActivityAt: latestIso(primary.lastActivityAt, secondary.lastActivityAt),
    lastError: primary.lastError ?? secondary.lastError,
    lastSessionSummary: primary.lastSessionSummary ?? secondary.lastSessionSummary,
    primaryMaterialization: primary.primaryMaterialization ?? secondary.primaryMaterialization,
    productLifecycle: primary.productLifecycle ?? secondary.productLifecycle,
    runtime: primary.runtime ?? secondary.runtime,
    selectedMaterializationId: primary.selectedMaterializationId ?? secondary.selectedMaterializationId,
    statusDetail: primary.statusDetail ?? secondary.statusDetail,
  };
}

function latestIso(left?: string | null, right?: string | null): string | null {
  if (!left) {
    return right ?? null;
  }
  if (!right) {
    return left;
  }
  return Date.parse(left) >= Date.parse(right) ? left : right;
}
