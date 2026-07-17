import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  InstallAgentRequest,
  ReconcileAgentsResponse,
  ReconcileAgentsRequest,
} from "@anyharness/sdk";
import { AnyHarnessError } from "@anyharness/sdk";
import {
  resolveRuntimeCacheScopeKey,
  resolveRuntimeConnection,
  useAnyHarnessCacheScopeKey,
  useAnyHarnessRuntimeContext,
} from "../context/AnyHarnessRuntime.js";
import {
  resolveWorkspaceConnectionFromContext,
  useAnyHarnessWorkspaceContext,
} from "../context/AnyHarnessWorkspace.js";
import { getAnyHarnessClient } from "../lib/client-cache.js";
import { requestOptionsWithSignal } from "../lib/request-options.js";
import {
  anyHarnessAgentReconcileStatusKey,
  anyHarnessAgentLaunchOptionsKey,
  anyHarnessAgentLaunchOptionsPrefixKey,
  anyHarnessAgentsKey,
  anyHarnessWorkspaceAgentsKey,
  anyHarnessWorkspaceAgentReconcileStatusKey,
  anyHarnessReconcileAgentsMutationKey,
} from "../lib/query-keys.js";

interface RuntimeQueryOptions {
  enabled?: boolean;
}

interface WorkspaceAgentQueryOptions extends RuntimeQueryOptions {
  workspaceId?: string | null;
}

export function useWorkspaceAgentsQuery(options?: WorkspaceAgentQueryOptions) {
  const workspace = useAnyHarnessWorkspaceContext();
  const cacheScopeKey = useAnyHarnessCacheScopeKey();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useQuery({
    queryKey: anyHarnessWorkspaceAgentsKey(cacheScopeKey, workspaceId),
    enabled: (options?.enabled ?? true) && !!workspaceId,
    queryFn: async ({ signal }) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.agents.list(requestOptionsWithSignal(undefined, signal));
    },
  });
}

export function useAgentsQuery(options?: RuntimeQueryOptions) {
  const runtime = useAnyHarnessRuntimeContext();
  const runtimeUrl = runtime.runtimeUrl?.trim() ?? "";
  const cacheScopeKey = resolveRuntimeCacheScopeKey(runtime);

  return useQuery({
    queryKey: anyHarnessAgentsKey(runtimeUrl, cacheScopeKey),
    enabled: (options?.enabled ?? true) && runtimeUrl.length > 0,
    queryFn: async ({ signal }) => {
      const client = getAnyHarnessClient(resolveRuntimeConnection(runtime));
      return client.agents.list(requestOptionsWithSignal(undefined, signal));
    },
  });
}

export function useAgentLaunchOptionsQuery(options?: RuntimeQueryOptions & {
  workspaceId?: string | null;
}) {
  const runtime = useAnyHarnessRuntimeContext();
  const runtimeUrl = runtime.runtimeUrl?.trim() ?? "";
  const cacheScopeKey = resolveRuntimeCacheScopeKey(runtime);
  const workspaceId = options?.workspaceId ?? null;

  return useQuery({
    queryKey: anyHarnessAgentLaunchOptionsKey(runtimeUrl, workspaceId, cacheScopeKey),
    enabled: (options?.enabled ?? true) && runtimeUrl.length > 0,
    queryFn: async ({ signal }) => {
      const client = getAnyHarnessClient(resolveRuntimeConnection(runtime));
      return client.agents.getLaunchOptions(
        workspaceId,
        requestOptionsWithSignal(undefined, signal),
      );
    },
  });
}

export function useInstallAgentMutation() {
  const runtime = useAnyHarnessRuntimeContext();
  const queryClient = useQueryClient();
  const runtimeUrl = runtime.runtimeUrl?.trim() ?? "";
  const cacheScopeKey = resolveRuntimeCacheScopeKey(runtime);

  return useMutation({
    mutationFn: async (input: { kind: string; request?: InstallAgentRequest }) => {
      const client = getAnyHarnessClient(resolveRuntimeConnection(runtime));
      return client.agents.install(input.kind, input.request ?? {});
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: anyHarnessAgentsKey(runtimeUrl, cacheScopeKey),
      });
    },
  });
}

export function useWorkspaceInstallAgentMutation(options?: {
  workspaceId?: string | null;
}) {
  const workspace = useAnyHarnessWorkspaceContext();
  const queryClient = useQueryClient();
  const cacheScopeKey = useAnyHarnessCacheScopeKey();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useMutation({
    mutationFn: async (input: { kind: string; request?: InstallAgentRequest }) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.agents.install(input.kind, input.request ?? {});
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: anyHarnessWorkspaceAgentsKey(cacheScopeKey, workspaceId),
      });
    },
  });
}

export function useStartAgentLoginMutation() {
  const runtime = useAnyHarnessRuntimeContext();

  return useMutation({
    mutationFn: async (kind: string) => {
      const client = getAnyHarnessClient(resolveRuntimeConnection(runtime));
      return client.agents.startLogin(kind);
    },
  });
}

export function useStartAgentLoginTerminalMutation() {
  const runtime = useAnyHarnessRuntimeContext();

  return useMutation({
    mutationFn: async (kind: string) => {
      const client = getAnyHarnessClient(resolveRuntimeConnection(runtime));
      return client.agents.startLoginTerminal(kind);
    },
  });
}

export function useCloseAgentLoginTerminalMutation() {
  const runtime = useAnyHarnessRuntimeContext();
  const queryClient = useQueryClient();
  const runtimeUrl = runtime.runtimeUrl?.trim() ?? "";
  const cacheScopeKey = resolveRuntimeCacheScopeKey(runtime);

  return useMutation({
    mutationFn: async (terminalId: string) => {
      const client = getAnyHarnessClient(resolveRuntimeConnection(runtime));
      await client.agents.closeLoginTerminal(terminalId);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: anyHarnessAgentsKey(runtimeUrl, cacheScopeKey),
      });
      await queryClient.invalidateQueries({
        queryKey: anyHarnessAgentLaunchOptionsPrefixKey(runtimeUrl, cacheScopeKey),
      });
    },
  });
}

interface AgentReconcileStatusQueryOptions extends RuntimeQueryOptions {
  refetchWhileActive?: boolean;
  discoverWhileIdle?: boolean;
}

export const AGENT_RECONCILE_DISCOVERY_INTERVAL_MS = 30_000;
export const AGENT_RECONCILE_ACTIVE_INTERVAL_MS = 1500;
export const AGENT_RECONCILE_DOWNLOAD_INTERVAL_MS = 750;

export function resolveAgentReconcileRefetchInterval(
  state: { data?: ReconcileAgentsResponse; error?: unknown },
  options: { refetchWhileActive: boolean; discoverWhileIdle: boolean },
): number | false {
  const status = state.data?.status;
  if (state.error instanceof AnyHarnessError && state.error.problem.status === 404) {
    return false;
  }
  if (status === "queued" || status === "running") {
    if (!options.refetchWhileActive) return false;
    const isDownloading = state.data?.progress?.components.some(
      (component) => component.phase === "downloading",
    );
    return isDownloading
      ? AGENT_RECONCILE_DOWNLOAD_INTERVAL_MS
      : AGENT_RECONCILE_ACTIVE_INTERVAL_MS;
  }
  if (!options.discoverWhileIdle) return false;
  return AGENT_RECONCILE_DISCOVERY_INTERVAL_MS;
}

export function useAgentReconcileStatusQuery(
  options?: AgentReconcileStatusQueryOptions,
) {
  const runtime = useAnyHarnessRuntimeContext();
  const runtimeUrl = runtime.runtimeUrl?.trim() ?? "";
  const cacheScopeKey = resolveRuntimeCacheScopeKey(runtime);
  const refetchWhileActive = options?.refetchWhileActive ?? true;
  const discoverWhileIdle = options?.discoverWhileIdle ?? false;

  return useQuery({
    queryKey: anyHarnessAgentReconcileStatusKey(runtimeUrl, cacheScopeKey),
    enabled: (options?.enabled ?? true) && runtimeUrl.length > 0,
    queryFn: async ({ signal }) => {
      const client = getAnyHarnessClient(resolveRuntimeConnection(runtime));
      return client.agents.getReconcileStatus(requestOptionsWithSignal(undefined, signal));
    },
    refetchInterval: (query) => resolveAgentReconcileRefetchInterval(query.state, {
      refetchWhileActive,
      discoverWhileIdle,
    }),
  });
}

export function useWorkspaceAgentReconcileStatusQuery(
  options?: AgentReconcileStatusQueryOptions & { workspaceId?: string | null },
) {
  const workspace = useAnyHarnessWorkspaceContext();
  const cacheScopeKey = useAnyHarnessCacheScopeKey();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;
  const refetchWhileActive = options?.refetchWhileActive ?? true;
  const discoverWhileIdle = options?.discoverWhileIdle ?? false;

  return useQuery({
    queryKey: anyHarnessWorkspaceAgentReconcileStatusKey(cacheScopeKey, workspaceId),
    enabled: (options?.enabled ?? true) && !!workspaceId,
    queryFn: async ({ signal }) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.agents.getReconcileStatus(requestOptionsWithSignal(undefined, signal));
    },
    refetchInterval: (query) => resolveAgentReconcileRefetchInterval(query.state, {
      refetchWhileActive,
      discoverWhileIdle,
    }),
  });
}

export function useReconcileAgentsMutation() {
  const runtime = useAnyHarnessRuntimeContext();
  const queryClient = useQueryClient();
  const runtimeUrl = runtime.runtimeUrl?.trim() ?? "";
  const cacheScopeKey = resolveRuntimeCacheScopeKey(runtime);

  return useMutation({
    mutationKey: anyHarnessReconcileAgentsMutationKey(runtimeUrl, cacheScopeKey),
    mutationFn: async (request?: ReconcileAgentsRequest) => {
      const client = getAnyHarnessClient(resolveRuntimeConnection(runtime));
      return client.agents.reconcile(request ?? {});
    },
    onSuccess: async (response) => {
      queryClient.setQueryData(
        anyHarnessAgentReconcileStatusKey(runtimeUrl, cacheScopeKey),
        response,
      );
      await queryClient.invalidateQueries({
        queryKey: anyHarnessAgentsKey(runtimeUrl, cacheScopeKey),
      });
    },
  });
}

export function useWorkspaceReconcileAgentsMutation(options?: {
  workspaceId?: string | null;
}) {
  const workspace = useAnyHarnessWorkspaceContext();
  const queryClient = useQueryClient();
  const cacheScopeKey = useAnyHarnessCacheScopeKey();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useMutation({
    mutationFn: async (request?: ReconcileAgentsRequest) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.agents.reconcile(request ?? {});
    },
    onSuccess: async (response) => {
      queryClient.setQueryData(
        anyHarnessWorkspaceAgentReconcileStatusKey(cacheScopeKey, workspaceId),
        response,
      );
      await queryClient.invalidateQueries({
        queryKey: anyHarnessWorkspaceAgentsKey(cacheScopeKey, workspaceId),
      });
    },
  });
}
