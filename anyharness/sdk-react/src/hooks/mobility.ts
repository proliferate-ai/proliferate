import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  DestroyWorkspaceMobilitySourceRequest,
  ExportWorkspaceMobilityArchiveRequest,
  UpdateWorkspaceMobilityRuntimeStateRequest,
  WorkspaceMobilityArchive,
} from "@anyharness/sdk";
import {
  useAnyHarnessWorkspaceContext,
  resolveWorkspaceConnectionFromContext,
} from "../context/AnyHarnessWorkspace.js";
import { useAnyHarnessRuntimeContext } from "../context/AnyHarnessRuntime.js";
import { getAnyHarnessClient } from "../lib/client-cache.js";
import { requestOptionsWithSignal } from "../lib/request-options.js";
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
    queryFn: async ({ signal }) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.mobility.preflight(
        resolved.connection.anyharnessWorkspaceId,
        requestOptionsWithSignal(undefined, signal),
      );
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
    mutationFn: async ({
      workspaceId: targetWorkspaceId,
      input,
    }: {
      workspaceId?: string | null;
      input: UpdateWorkspaceMobilityRuntimeStateRequest;
    }) => {
      const resolved = await resolveWorkspaceConnectionFromContext(
        workspace,
        targetWorkspaceId ?? workspaceId,
      );
      const client = getAnyHarnessClient(resolved.connection);
      return client.mobility.updateRuntimeState(
        resolved.connection.anyharnessWorkspaceId,
        input,
      );
    },
    onSuccess: async (_, variables) => {
      const targetWorkspaceId = variables.workspaceId ?? workspaceId;
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: anyHarnessWorkspaceMobilityPreflightKey(runtimeUrl, targetWorkspaceId),
        }),
        queryClient.invalidateQueries({
          queryKey: anyHarnessWorkspaceMobilityRuntimeStateKey(runtimeUrl, targetWorkspaceId),
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
    mutationFn: async ({
      workspaceId: targetWorkspaceId,
      input,
    }: {
      workspaceId?: string | null;
      input?: ExportWorkspaceMobilityArchiveRequest;
    } = {}) => {
      const resolved = await resolveWorkspaceConnectionFromContext(
        workspace,
        targetWorkspaceId ?? workspaceId,
      );
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
    mutationFn: async ({
      workspaceId: targetWorkspaceId,
      archive,
    }: {
      workspaceId?: string | null;
      archive: WorkspaceMobilityArchive;
    }) => {
      const resolved = await resolveWorkspaceConnectionFromContext(
        workspace,
        targetWorkspaceId ?? workspaceId,
      );
      const client = getAnyHarnessClient(resolved.connection);
      return client.mobility.installArchive(
        resolved.connection.anyharnessWorkspaceId,
        archive,
      );
    },
    onSuccess: async (_, variables) => {
      const targetWorkspaceId = variables.workspaceId ?? workspaceId;
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: anyHarnessSessionsKey(runtimeUrl, targetWorkspaceId),
        }),
        queryClient.invalidateQueries({
          queryKey: anyHarnessWorkspaceMobilityPreflightKey(runtimeUrl, targetWorkspaceId),
        }),
        queryClient.invalidateQueries({
          queryKey: anyHarnessWorkspaceMobilityRuntimeStateKey(runtimeUrl, targetWorkspaceId),
        }),
      ]);
    },
  });
}

export function useDestroyWorkspaceMobilitySourceMutation(
  options?: { workspaceId?: string | null },
) {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const queryClient = useQueryClient();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useMutation({
    mutationFn: async ({
      workspaceId: targetWorkspaceId,
      input,
    }: {
      workspaceId?: string | null;
      input?: DestroyWorkspaceMobilitySourceRequest;
    }) => {
      const resolved = await resolveWorkspaceConnectionFromContext(
        workspace,
        targetWorkspaceId ?? workspaceId,
      );
      const client = getAnyHarnessClient(resolved.connection);
      return client.mobility.destroySource(
        resolved.connection.anyharnessWorkspaceId,
        input,
      );
    },
    onSuccess: async (_, variables) => {
      const targetWorkspaceId = variables.workspaceId ?? workspaceId;
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: anyHarnessSessionsKey(runtimeUrl, targetWorkspaceId),
        }),
        queryClient.invalidateQueries({
          queryKey: anyHarnessWorkspaceMobilityPreflightKey(runtimeUrl, targetWorkspaceId),
        }),
        queryClient.invalidateQueries({
          queryKey: anyHarnessWorkspaceMobilityRuntimeStateKey(runtimeUrl, targetWorkspaceId),
        }),
      ]);
    },
  });
}
