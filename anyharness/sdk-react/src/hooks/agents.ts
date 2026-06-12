import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  InstallAgentRequest,
  ReconcileAgentsRequest,
} from "@anyharness/sdk";
import { useAnyHarnessRuntimeContext, resolveRuntimeConnection } from "../context/AnyHarnessRuntime.js";
import { getAnyHarnessClient } from "../lib/client-cache.js";
import { requestOptionsWithSignal } from "../lib/request-options.js";
import {
  anyHarnessAgentReconcileStatusKey,
  anyHarnessAgentLaunchOptionsKey,
  anyHarnessAgentLaunchOptionsPrefixKey,
  anyHarnessAgentsKey,
  anyHarnessReconcileAgentsMutationKey,
} from "../lib/query-keys.js";

interface RuntimeQueryOptions {
  enabled?: boolean;
}

export function useAgentsQuery(options?: RuntimeQueryOptions) {
  const runtime = useAnyHarnessRuntimeContext();
  const runtimeUrl = runtime.runtimeUrl?.trim() ?? "";

  return useQuery({
    queryKey: anyHarnessAgentsKey(runtimeUrl),
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
  const workspaceId = options?.workspaceId ?? null;

  return useQuery({
    queryKey: anyHarnessAgentLaunchOptionsKey(runtimeUrl, workspaceId),
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

  return useMutation({
    mutationFn: async (input: { kind: string; request?: InstallAgentRequest }) => {
      const client = getAnyHarnessClient(resolveRuntimeConnection(runtime));
      return client.agents.install(input.kind, input.request ?? {});
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: anyHarnessAgentsKey(runtimeUrl) });
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

  return useMutation({
    mutationFn: async (terminalId: string) => {
      const client = getAnyHarnessClient(resolveRuntimeConnection(runtime));
      await client.agents.closeLoginTerminal(terminalId);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: anyHarnessAgentsKey(runtimeUrl) });
      await queryClient.invalidateQueries({
        queryKey: anyHarnessAgentLaunchOptionsPrefixKey(runtimeUrl),
      });
    },
  });
}

interface AgentReconcileStatusQueryOptions extends RuntimeQueryOptions {
  refetchWhileActive?: boolean;
}

export function useAgentReconcileStatusQuery(
  options?: AgentReconcileStatusQueryOptions,
) {
  const runtime = useAnyHarnessRuntimeContext();
  const runtimeUrl = runtime.runtimeUrl?.trim() ?? "";
  const refetchWhileActive = options?.refetchWhileActive ?? true;

  return useQuery({
    queryKey: anyHarnessAgentReconcileStatusKey(runtimeUrl),
    enabled: (options?.enabled ?? true) && runtimeUrl.length > 0,
    queryFn: async ({ signal }) => {
      const client = getAnyHarnessClient(resolveRuntimeConnection(runtime));
      return client.agents.getReconcileStatus(requestOptionsWithSignal(undefined, signal));
    },
    refetchInterval: (query) => {
      if (!refetchWhileActive) return false;
      const status = query.state.data?.status;
      if (status === "queued" || status === "running") {
        return 2000;
      }
      return false;
    },
  });
}

export function useReconcileAgentsMutation() {
  const runtime = useAnyHarnessRuntimeContext();
  const queryClient = useQueryClient();
  const runtimeUrl = runtime.runtimeUrl?.trim() ?? "";

  return useMutation({
    mutationKey: anyHarnessReconcileAgentsMutationKey(runtimeUrl),
    mutationFn: async (request?: ReconcileAgentsRequest) => {
      const client = getAnyHarnessClient(resolveRuntimeConnection(runtime));
      return client.agents.reconcile(request ?? {});
    },
    onSuccess: async (response) => {
      queryClient.setQueryData(anyHarnessAgentReconcileStatusKey(runtimeUrl), response);
      await queryClient.invalidateQueries({ queryKey: anyHarnessAgentsKey(runtimeUrl) });
    },
  });
}
