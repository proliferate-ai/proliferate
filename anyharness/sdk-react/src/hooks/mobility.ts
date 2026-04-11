import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ExportWorkspaceMobilityArchiveRequest,
  UpdateWorkspaceMobilityRuntimeStateRequest,
  WorkspaceMobilityArchive,
  WorkspaceMobilityCleanupRequest,
} from "@anyharness/sdk";
import {
  useAnyHarnessWorkspaceContext,
  resolveWorkspaceConnectionFromContext,
} from "../context/AnyHarnessWorkspace.js";
import { useAnyHarnessRuntimeContext } from "../context/AnyHarnessRuntime.js";
import { getAnyHarnessClient } from "../lib/client-cache.js";
import {
  anyHarnessSessionsKey,
  anyHarnessWorkspaceMobilityPreflightKey,
  anyHarnessWorkspaceMobilityRuntimeStateKey,
} from "../lib/query-keys.js";

interface WorkspaceQueryOptions {
  workspaceId?: string | null;
  enabled?: boolean;
}

function useWorkspaceRuntimeUrl() {
  const runtime = useAnyHarnessRuntimeContext();
  return runtime.runtimeUrl?.trim() ?? "";
}

export function useWorkspaceMobilityPreflightQuery(options?: WorkspaceQueryOptions) {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useQuery({
    queryKey: anyHarnessWorkspaceMobilityPreflightKey(runtimeUrl, workspaceId),
    enabled: (options?.enabled ?? true) && !!workspaceId,
    queryFn: async () => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.mobility.preflight(resolved.connection.anyharnessWorkspaceId);
    },
  });
}

export function useUpdateWorkspaceMobilityRuntimeStateMutation(
  options?: { workspaceId?: string | null },
) {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const queryClient = useQueryClient();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useMutation({
    mutationFn: async (input: UpdateWorkspaceMobilityRuntimeStateRequest) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.mobility.updateRuntimeState(
        resolved.connection.anyharnessWorkspaceId,
        input,
      );
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: anyHarnessWorkspaceMobilityPreflightKey(runtimeUrl, workspaceId),
        }),
        queryClient.invalidateQueries({
          queryKey: anyHarnessWorkspaceMobilityRuntimeStateKey(runtimeUrl, workspaceId),
        }),
      ]);
    },
  });
}

export function useExportWorkspaceMobilityArchiveMutation(
  options?: { workspaceId?: string | null },
) {
  const workspace = useAnyHarnessWorkspaceContext();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useMutation({
    mutationFn: async (input?: ExportWorkspaceMobilityArchiveRequest) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.mobility.exportArchive(
        resolved.connection.anyharnessWorkspaceId,
        input,
      );
    },
  });
}

export function useInstallWorkspaceMobilityArchiveMutation(
  options?: { workspaceId?: string | null },
) {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const queryClient = useQueryClient();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useMutation({
    mutationFn: async (archive: WorkspaceMobilityArchive) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.mobility.installArchive(
        resolved.connection.anyharnessWorkspaceId,
        archive,
      );
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: anyHarnessSessionsKey(runtimeUrl, workspaceId),
        }),
        queryClient.invalidateQueries({
          queryKey: anyHarnessWorkspaceMobilityPreflightKey(runtimeUrl, workspaceId),
        }),
        queryClient.invalidateQueries({
          queryKey: anyHarnessWorkspaceMobilityRuntimeStateKey(runtimeUrl, workspaceId),
        }),
      ]);
    },
  });
}

export function useCleanupWorkspaceMobilityMutation(
  options?: { workspaceId?: string | null },
) {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const queryClient = useQueryClient();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useMutation({
    mutationFn: async (input: WorkspaceMobilityCleanupRequest) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.mobility.cleanup(
        resolved.connection.anyharnessWorkspaceId,
        input,
      );
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: anyHarnessSessionsKey(runtimeUrl, workspaceId),
        }),
        queryClient.invalidateQueries({
          queryKey: anyHarnessWorkspaceMobilityPreflightKey(runtimeUrl, workspaceId),
        }),
        queryClient.invalidateQueries({
          queryKey: anyHarnessWorkspaceMobilityRuntimeStateKey(runtimeUrl, workspaceId),
        }),
      ]);
    },
  });
}
