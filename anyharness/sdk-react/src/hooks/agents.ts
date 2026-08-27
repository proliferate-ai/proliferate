import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  AgentLoginVariant,
  HarnessLaunchOptionsResponse,
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

export const AGENT_LAUNCH_OPTIONS_PROBE_INTERVAL_MS = 1500;

/**
 * The ONE polling policy behind both launch-option queries.
 *
 * A launch-option response is a snapshot of a revision, and the runtime raises
 * no event when a later one lands: a client that reads `detecting` once holds
 * that provisional answer until something else happens to invalidate it. So the
 * response says whether anything is still coming, and this decides whether to
 * wait for it.
 *
 * `detecting` alone cannot: a harness excluded from unattended probes sits
 * `detecting` forever by design, and polling it would be a permanent request
 * loop against an answer that will never change. `probePhase` is what separates
 * an active probe from a settled-unobserved one.
 *
 * The four terminal states never poll — their probe is over, and the next
 * observation arrives through the events that already invalidate this cache.
 * There is no client-side timeout: a probe that is genuinely running is worth
 * waiting for however long it takes, and one that stops running says so.
 */
export function resolveAgentLaunchOptionsRefetchInterval(
  state: { data?: HarnessLaunchOptionsResponse },
): number | false {
  const response = state.data;
  if (!response) return false;
  switch (response.state) {
    case "refreshing":
      // A re-probe over last-good data: the data stays readable while we wait.
      return AGENT_LAUNCH_OPTIONS_PROBE_INTERVAL_MS;
    case "detecting":
      return response.probePhase === "queued" || response.probePhase === "running"
        ? AGENT_LAUNCH_OPTIONS_PROBE_INTERVAL_MS
        : false;
    default:
      return false;
  }
}

function launchOptionsRefetchInterval(
  query: { state: { data?: HarnessLaunchOptionsResponse } },
): number | false {
  return resolveAgentLaunchOptionsRefetchInterval(query.state);
}

export function useAgentLaunchOptionsQuery(options?: RuntimeQueryOptions & {
  harnessKind?: string | null;
}) {
  const runtime = useAnyHarnessRuntimeContext();
  const runtimeUrl = runtime.runtimeUrl?.trim() ?? "";
  const cacheScopeKey = resolveRuntimeCacheScopeKey(runtime);
  const harnessKind = options?.harnessKind?.trim() ?? "";

  return useQuery({
    queryKey: anyHarnessAgentLaunchOptionsKey(runtimeUrl, harnessKind, cacheScopeKey),
    enabled: (options?.enabled ?? true) && runtimeUrl.length > 0 && harnessKind.length > 0,
    queryFn: async ({ signal }) => {
      const client = getAnyHarnessClient(resolveRuntimeConnection(runtime));
      return client.agents.getLaunchOptions(harnessKind, requestOptionsWithSignal(undefined, signal));
    },
    refetchInterval: launchOptionsRefetchInterval,
  });
}

/**
 * One entry per requested harness kind, in request order.
 *
 * `data` alone cannot say why it is absent, and the three reasons want
 * different treatment: a kind still loading is not a kind whose runtime
 * refused it, and neither is a kind that answered with nothing. The flags keep
 * those apart at the seam that knows them.
 */
export interface AgentLaunchOptionsListEntry {
  harnessKind: string;
  data: HarnessLaunchOptionsResponse | null;
  /** In flight right now. A disabled entry is not pending: nothing will resolve it. */
  isPending: boolean;
  isError: boolean;
}

/**
 * Launch options for several harnesses at once, sharing the per-kind cache
 * entries of [`useAgentLaunchOptionsQuery`] — including its polling policy, so
 * a fanned-out kind converges on the same terms as a singly-read one.
 *
 * `combine`'s result is structurally shared by the query cache, so an entry
 * whose contents are unchanged keeps its reference across renders.
 */
export function useAgentLaunchOptionsListQuery(options?: RuntimeQueryOptions & {
  harnessKinds?: readonly string[];
}): AgentLaunchOptionsListEntry[] {
  const runtime = useAnyHarnessRuntimeContext();
  const runtimeUrl = runtime.runtimeUrl?.trim() ?? "";
  const cacheScopeKey = resolveRuntimeCacheScopeKey(runtime);
  const harnessKinds = (options?.harnessKinds ?? [])
    .map((kind) => kind.trim())
    .filter((kind) => kind.length > 0);

  return useQueries({
    queries: harnessKinds.map((harnessKind) => ({
      queryKey: anyHarnessAgentLaunchOptionsKey(runtimeUrl, harnessKind, cacheScopeKey),
      enabled: (options?.enabled ?? true) && runtimeUrl.length > 0,
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        const client = getAnyHarnessClient(resolveRuntimeConnection(runtime));
        return client.agents.getLaunchOptions(harnessKind, requestOptionsWithSignal(undefined, signal));
      },
      refetchInterval: launchOptionsRefetchInterval,
    })),
    combine: (results): AgentLaunchOptionsListEntry[] => results.map((result, index) => ({
      harnessKind: harnessKinds[index] ?? "",
      data: result.data ?? null,
      // A DISABLED query with no data is `status: "pending"` in v5, so the raw flag
      // reports "still loading" for a fan-out that is not running and never will
      // until the runtime URL arrives. A consumer renders that as a control waiting
      // on something, forever. `fetchStatus` is what separates the two.
      isPending: result.isPending && result.fetchStatus !== "idle",
      isError: result.isError,
    })),
  });
}

export function useRefreshHarnessLaunchOptionsMutation() {
  const runtime = useAnyHarnessRuntimeContext();
  const queryClient = useQueryClient();
  const runtimeUrl = runtime.runtimeUrl?.trim() ?? "";
  const cacheScopeKey = resolveRuntimeCacheScopeKey(runtime);
  return useMutation({
    // The probe targets the LOCAL runtime, so react-query's default "online"
    // gate is simply wrong for it: offline, the mutation is parked without
    // ever invoking `mutationFn`, so `mutateAsync` never settles and any
    // caller awaiting it waits forever — on a machine where the refresh would
    // have succeeded.
    networkMode: "always",
    mutationFn: async (harnessKind: string) => {
      const client = getAnyHarnessClient(resolveRuntimeConnection(runtime));
      return client.agents.refreshLaunchOptions(harnessKind);
    },
    onSuccess: async (response) => {
      queryClient.setQueryData(
        anyHarnessAgentLaunchOptionsKey(runtimeUrl, response.harnessKind, cacheScopeKey),
        response,
      );
    },
    // A refresh that ends 5xx still changed the runtime: it durably records
    // `failed_without_observation` before it answers. Leaving the cache on the
    // pre-refresh revision would show a state the runtime no longer holds, so
    // reread exactly this harness's entry.
    onError: async (_error, harnessKind) => {
      await queryClient.invalidateQueries({
        queryKey: anyHarnessAgentLaunchOptionsKey(runtimeUrl, harnessKind, cacheScopeKey),
        exact: true,
      });
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
    mutationFn: async (
      input: string | { kind: string; variant?: AgentLoginVariant },
    ) => {
      const client = getAnyHarnessClient(resolveRuntimeConnection(runtime));
      const { kind, variant } =
        typeof input === "string" ? { kind: input, variant: undefined } : input;
      return client.agents.startLoginTerminal(kind, variant);
    },
  });
}

/**
 * The one-time seat-token handoff (seats v1): the runtime serves the captured
 * mint token exactly once and wipes its buffer. Callers keep the token in
 * memory only and POST it straight to the vault — never persisted client-side.
 */
export function useClaimAgentMintTokenMutation() {
  const runtime = useAnyHarnessRuntimeContext();

  return useMutation({
    mutationFn: async (terminalId: string) => {
      const client = getAnyHarnessClient(resolveRuntimeConnection(runtime));
      return client.agents.claimMintToken(terminalId);
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
