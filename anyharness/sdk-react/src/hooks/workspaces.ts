import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateWorkspaceRequest,
  CreateWorktreeWorkspaceRequest,
  RegisterRepoWorkspaceRequest,
  StartWorkspaceSetupRequest,
} from "@anyharness/sdk";
import { useAnyHarnessRuntimeContext, resolveRuntimeConnection } from "../context/AnyHarnessRuntime.js";
import {
  useAnyHarnessWorkspaceContext,
  resolveWorkspaceConnectionFromContext,
} from "../context/AnyHarnessWorkspace.js";
import {
  getAnyHarnessClient,
  type AnyHarnessClientConnection,
} from "../lib/client-cache.js";
import {
  anyHarnessRuntimeWorkspacesKey,
  anyHarnessWorkspaceDetectSetupKey,
  anyHarnessWorkspaceSessionLaunchKey,
  anyHarnessWorkspaceSetupStatusKey,
} from "../lib/query-keys.js";

interface RuntimeQueryOptions {
  enabled?: boolean;
}

interface WorkspaceQueryOptions {
  workspaceId?: string | null;
  enabled?: boolean;
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
    queryFn: async () => {
      const client = getAnyHarnessClient(resolveRuntimeConnection(runtime));
      return client.workspaces.list();
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
    },
  });
}

export function useRegisterRepoWorkspaceMutation() {
  const runtime = useAnyHarnessRuntimeContext();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: RegisterRepoWorkspaceRequest & {
      connection?: AnyHarnessClientConnection;
    }) => {
      const client = getAnyHarnessClient(
        input.connection ?? resolveRuntimeConnection(runtime),
      );
      return client.workspaces.registerRepoFromPath(input.path);
    },
    onSuccess: async (_data, input) => {
      const runtimeUrl = input.connection?.runtimeUrl?.trim()
        ?? runtime.runtimeUrl?.trim()
        ?? "";
      await queryClient.invalidateQueries({
        queryKey: anyHarnessRuntimeWorkspacesKey(runtimeUrl),
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

export function useDetectProjectSetupQuery(options?: WorkspaceQueryOptions) {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useQuery({
    queryKey: anyHarnessWorkspaceDetectSetupKey(runtimeUrl, workspaceId),
    enabled: (options?.enabled ?? true) && !!workspaceId,
    staleTime: Infinity,
    queryFn: async () => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.workspaces.detectSetup(
        resolved.connection.anyharnessWorkspaceId,
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
    queryFn: async () => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.workspaces.getSetupStatus(
        resolved.connection.anyharnessWorkspaceId,
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
    queryFn: async () => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.workspaces.getSessionLaunchCatalog(
        resolved.connection.anyharnessWorkspaceId,
      );
    },
  });
}
