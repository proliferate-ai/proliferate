import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AnyHarnessRequestOptions,
  CreateWorkspaceRequest,
  CreateWorktreeWorkspaceRequest,
  StartWorkspaceSetupRequest,
  UpdateWorkspaceDisplayNameRequest,
} from "@anyharness/sdk";
import { useAnyHarnessRuntimeContext, resolveRuntimeConnection } from "../context/AnyHarnessRuntime.js";
import {
  useAnyHarnessWorkspaceContext,
  resolveWorkspaceConnectionFromContext,
} from "../context/AnyHarnessWorkspace.js";
import {
  getAnyHarnessClient,
} from "../lib/client-cache.js";
import {
  anyHarnessRepoRootsKey,
  anyHarnessRuntimeWorkspacesKey,
  anyHarnessWorkspaceQueryKeyRoots,
  anyHarnessWorktreesInventoryKey,
  anyHarnessWorkspacePurgePreflightKey,
  anyHarnessWorkspaceDetectSetupKey,
  anyHarnessWorkspaceRetirePreflightKey,
  anyHarnessWorkspaceSessionLaunchKey,
  anyHarnessWorkspaceSetupStatusKey,
} from "../lib/query-keys.js";
import { requestOptionsWithSignal } from "../lib/request-options.js";

interface RuntimeQueryOptions {
  enabled?: boolean;
  requestOptions?: AnyHarnessRequestOptions;
}

interface WorkspaceQueryOptions {
  workspaceId?: string | null;
  enabled?: boolean;
  requestOptions?: AnyHarnessRequestOptions;
}

function useWorkspaceRuntimeUrl() {
  const runtime = useAnyHarnessRuntimeContext();
  return runtime.runtimeUrl?.trim() ?? "";
}

export function useRuntimeWorkspacesQuery(options?: RuntimeQueryOptions) {
  const runtime = useAnyHarnessRuntimeContext();
  const runtimeUrl = runtime.runtimeUrl?.trim() ?? "";

  return useQuery({
    queryKey: anyHarnessRuntimeWorkspacesKey(runtimeUrl),
    enabled: (options?.enabled ?? true) && runtimeUrl.length > 0,
    queryFn: async ({ signal }) => {
      const client = getAnyHarnessClient(resolveRuntimeConnection(runtime));
      return client.workspaces.list(requestOptionsWithSignal(options?.requestOptions, signal));
    },
  });
}

export function useWorkspaceQuery(options: WorkspaceQueryOptions) {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const workspaceId = options.workspaceId ?? workspace.workspaceId;

  return useQuery({
    queryKey: [...anyHarnessWorkspaceQueryKeyRoots(runtimeUrl, workspaceId), "detail"] as const,
    enabled: (options.enabled ?? true) && !!workspaceId,
    queryFn: async ({ signal }) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.workspaces.get(
        resolved.connection.anyharnessWorkspaceId,
        requestOptionsWithSignal(options.requestOptions, signal),
      );
    },
  });
}

export function useResolveWorkspaceFromPathMutation() {
  const runtime = useAnyHarnessRuntimeContext();
  const queryClient = useQueryClient();
  const runtimeUrl = runtime.runtimeUrl?.trim() ?? "";

  return useMutation({
    mutationFn: async (path: string) => {
      const client = getAnyHarnessClient(resolveRuntimeConnection(runtime));
      return client.workspaces.resolveFromPath(path);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: anyHarnessRuntimeWorkspacesKey(runtimeUrl),
      });
      await queryClient.invalidateQueries({
        queryKey: anyHarnessRepoRootsKey(runtimeUrl),
      });
    },
  });
}

export function useCreateWorkspaceMutation() {
  const runtime = useAnyHarnessRuntimeContext();
  const queryClient = useQueryClient();
  const runtimeUrl = runtime.runtimeUrl?.trim() ?? "";

  return useMutation({
    mutationFn: async (input: CreateWorkspaceRequest) => {
      const client = getAnyHarnessClient(resolveRuntimeConnection(runtime));
      return client.workspaces.create(input);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: anyHarnessRuntimeWorkspacesKey(runtimeUrl),
      });
      await queryClient.invalidateQueries({
        queryKey: anyHarnessRepoRootsKey(runtimeUrl),
      });
    },
  });
}

export function useCreateWorktreeWorkspaceMutation() {
  const runtime = useAnyHarnessRuntimeContext();
  const queryClient = useQueryClient();
  const runtimeUrl = runtime.runtimeUrl?.trim() ?? "";

  return useMutation({
    mutationFn: async (input: CreateWorktreeWorkspaceRequest) => {
      const client = getAnyHarnessClient(resolveRuntimeConnection(runtime));
      return client.workspaces.createWorktree(input);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: anyHarnessRuntimeWorkspacesKey(runtimeUrl),
      });
    },
  });
}

export function useUpdateWorkspaceDisplayNameMutation() {
  const runtime = useAnyHarnessRuntimeContext();
  const workspace = useAnyHarnessWorkspaceContext();
  const queryClient = useQueryClient();
  const runtimeUrl = runtime.runtimeUrl?.trim() ?? "";

  return useMutation({
    mutationFn: async ({
      workspaceId,
      request,
      requestOptions,
    }: {
      workspaceId: string;
      request: UpdateWorkspaceDisplayNameRequest;
      requestOptions?: AnyHarnessRequestOptions;
    }) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.workspaces.updateDisplayName(
        resolved.connection.anyharnessWorkspaceId,
        request,
        requestOptions,
      );
    },
    onSuccess: async (_data, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: anyHarnessRuntimeWorkspacesKey(runtimeUrl),
        }),
        queryClient.invalidateQueries({
          queryKey: anyHarnessWorkspaceQueryKeyRoots(runtimeUrl, variables.workspaceId),
        }),
      ]);
    },
  });
}

export function useRetireWorkspacePreflightQuery(options?: WorkspaceQueryOptions) {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useQuery({
    queryKey: anyHarnessWorkspaceRetirePreflightKey(runtimeUrl, workspaceId),
    enabled: (options?.enabled ?? true) && !!workspaceId,
    staleTime: 60_000,
    queryFn: async ({ signal }) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.workspaces.retirePreflight(
        resolved.connection.anyharnessWorkspaceId,
        requestOptionsWithSignal(options?.requestOptions, signal),
      );
    },
  });
}

export function usePurgeWorkspacePreflightQuery(options?: WorkspaceQueryOptions) {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useQuery({
    queryKey: anyHarnessWorkspacePurgePreflightKey(runtimeUrl, workspaceId),
    enabled: (options?.enabled ?? true) && !!workspaceId,
    staleTime: 60_000,
    queryFn: async ({ signal }) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.workspaces.purgePreflight(
        resolved.connection.anyharnessWorkspaceId,
        requestOptionsWithSignal(options?.requestOptions, signal),
      );
    },
  });
}

export function useRetireWorkspaceMutation() {
  const runtime = useAnyHarnessRuntimeContext();
  const workspace = useAnyHarnessWorkspaceContext();
  const queryClient = useQueryClient();
  const runtimeUrl = runtime.runtimeUrl?.trim() ?? "";

  return useMutation({
    mutationFn: async (workspaceId: string) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.workspaces.retire(resolved.connection.anyharnessWorkspaceId);
    },
    onSuccess: async (_data, workspaceId) => {
      await queryClient.invalidateQueries({
        queryKey: anyHarnessRuntimeWorkspacesKey(runtimeUrl),
      });
      await queryClient.invalidateQueries({
        queryKey: anyHarnessWorkspaceRetirePreflightKey(runtimeUrl, workspaceId),
      });
    },
  });
}

export function useRetryRetireCleanupMutation() {
  const runtime = useAnyHarnessRuntimeContext();
  const workspace = useAnyHarnessWorkspaceContext();
  const queryClient = useQueryClient();
  const runtimeUrl = runtime.runtimeUrl?.trim() ?? "";

  return useMutation({
    mutationFn: async (workspaceId: string) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.workspaces.retryRetireCleanup(
        resolved.connection.anyharnessWorkspaceId,
      );
    },
    onSuccess: async (_data, workspaceId) => {
      await queryClient.invalidateQueries({
        queryKey: anyHarnessRuntimeWorkspacesKey(runtimeUrl),
      });
      await queryClient.invalidateQueries({
        queryKey: anyHarnessWorkspaceRetirePreflightKey(runtimeUrl, workspaceId),
      });
    },
  });
}

export function usePurgeWorkspaceMutation() {
  const runtime = useAnyHarnessRuntimeContext();
  const workspace = useAnyHarnessWorkspaceContext();
  const queryClient = useQueryClient();
  const runtimeUrl = runtime.runtimeUrl?.trim() ?? "";

  return useMutation({
    mutationFn: async (workspaceId: string) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.workspaces.purge(resolved.connection.anyharnessWorkspaceId);
    },
    onSuccess: async (_data, workspaceId) => {
      await queryClient.invalidateQueries({
        queryKey: anyHarnessRuntimeWorkspacesKey(runtimeUrl),
      });
      await queryClient.invalidateQueries({
        queryKey: anyHarnessWorktreesInventoryKey(runtimeUrl),
      });
      await queryClient.invalidateQueries({
        queryKey: anyHarnessWorkspacePurgePreflightKey(runtimeUrl, workspaceId),
      });
    },
  });
}

export function useRetryPurgeWorkspaceMutation() {
  const runtime = useAnyHarnessRuntimeContext();
  const workspace = useAnyHarnessWorkspaceContext();
  const queryClient = useQueryClient();
  const runtimeUrl = runtime.runtimeUrl?.trim() ?? "";

  return useMutation({
    mutationFn: async (workspaceId: string) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.workspaces.retryPurge(
        resolved.connection.anyharnessWorkspaceId,
      );
    },
    onSuccess: async (_data, workspaceId) => {
      await queryClient.invalidateQueries({
        queryKey: anyHarnessRuntimeWorkspacesKey(runtimeUrl),
      });
      await queryClient.invalidateQueries({
        queryKey: anyHarnessWorktreesInventoryKey(runtimeUrl),
      });
      await queryClient.invalidateQueries({
        queryKey: anyHarnessWorkspacePurgePreflightKey(runtimeUrl, workspaceId),
      });
    },
  });
}

export function useDetectProjectSetupQuery(options?: WorkspaceQueryOptions) {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useQuery({
    queryKey: anyHarnessWorkspaceDetectSetupKey(runtimeUrl, workspaceId),
    enabled: (options?.enabled ?? true) && !!workspaceId,
    staleTime: Infinity,
    queryFn: async ({ signal }) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.workspaces.detectSetup(
        resolved.connection.anyharnessWorkspaceId,
        requestOptionsWithSignal(options?.requestOptions, signal),
      );
    },
  });
}

export function useSetupStatusQuery(options?: WorkspaceQueryOptions & { refetchWhileRunning?: boolean }) {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;
  const refetchWhileRunning = options?.refetchWhileRunning ?? true;

  return useQuery({
    queryKey: anyHarnessWorkspaceSetupStatusKey(runtimeUrl, workspaceId),
    enabled: (options?.enabled ?? true) && !!workspaceId,
    // Don't retry on 404 (no setup job exists for this workspace)
    retry: (failureCount, error) => {
      if (error instanceof Error && error.message.includes("404")) return false;
      return failureCount < 2;
    },
    queryFn: async ({ signal }) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.workspaces.getSetupStatus(
        resolved.connection.anyharnessWorkspaceId,
        requestOptionsWithSignal(options?.requestOptions, signal),
      );
    },
    // Poll every 2s while setup is running, stop on terminal state
    refetchInterval: (query) => {
      if (!refetchWhileRunning) return false;
      const status = query.state.data?.status;
      if (status === "queued" || status === "running") return 2000;
      return false;
    },
  });
}

export function useRerunSetupMutation() {
  const runtime = useAnyHarnessRuntimeContext();
  const workspace = useAnyHarnessWorkspaceContext();
  const queryClient = useQueryClient();
  const runtimeUrl = runtime.runtimeUrl?.trim() ?? "";

  return useMutation({
    mutationFn: async (workspaceId: string) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.workspaces.rerunSetup(
        resolved.connection.anyharnessWorkspaceId,
      );
    },
    onSuccess: async (_data, workspaceId) => {
      await queryClient.invalidateQueries({
        queryKey: anyHarnessWorkspaceSetupStatusKey(runtimeUrl, workspaceId),
      });
    },
  });
}

export function useStartSetupMutation() {
  const runtime = useAnyHarnessRuntimeContext();
  const workspace = useAnyHarnessWorkspaceContext();
  const queryClient = useQueryClient();
  const runtimeUrl = runtime.runtimeUrl?.trim() ?? "";

  return useMutation({
    mutationFn: async ({
      workspaceId,
      input,
    }: {
      workspaceId: string;
      input: StartWorkspaceSetupRequest;
    }) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.workspaces.startSetup(
        resolved.connection.anyharnessWorkspaceId,
        input,
      );
    },
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({
        queryKey: anyHarnessWorkspaceSetupStatusKey(runtimeUrl, variables.workspaceId),
      });
    },
  });
}

export function useWorkspaceSessionLaunchQuery(options?: WorkspaceQueryOptions) {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useQuery({
    queryKey: anyHarnessWorkspaceSessionLaunchKey(runtimeUrl, workspaceId),
    enabled: (options?.enabled ?? true) && !!workspaceId,
    queryFn: async ({ signal }) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.workspaces.getSessionLaunchCatalog(
        resolved.connection.anyharnessWorkspaceId,
        requestOptionsWithSignal(options?.requestOptions, signal),
      );
    },
  });
}
