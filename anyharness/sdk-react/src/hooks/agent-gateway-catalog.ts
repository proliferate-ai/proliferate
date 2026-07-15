import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AnyHarnessClient } from "@anyharness/sdk";
import {
  useAnyHarnessRuntimeContext,
  resolveRuntimeCacheScopeKey,
  resolveRuntimeConnection,
  type AnyHarnessRuntimeContextValue,
} from "../context/AnyHarnessRuntime.js";
import { getAnyHarnessClient } from "../lib/client-cache.js";
import { requestOptionsWithSignal } from "../lib/request-options.js";
import { anyHarnessAgentGatewayModelsKey } from "../lib/query-keys.js";

interface RuntimeQueryOptions {
  enabled?: boolean;
  /** Poll on an interval (e.g. for a background sync); `false`/omitted = no polling. */
  refetchInterval?: number | false;
}

/** Shared query definition so the singular and plural (`useQueries`) hooks below stay in lockstep. */
function gatewayModelsQueryOptions(
  runtime: AnyHarnessRuntimeContextValue,
  kind: string,
  options?: RuntimeQueryOptions,
) {
  const runtimeUrl = runtime.runtimeUrl?.trim() ?? "";
  const cacheScopeKey = resolveRuntimeCacheScopeKey(runtime);
  const trimmedKind = kind.trim();

  return {
    queryKey: anyHarnessAgentGatewayModelsKey(runtimeUrl, trimmedKind, cacheScopeKey),
    enabled: (options?.enabled ?? true) && runtimeUrl.length > 0 && trimmedKind.length > 0,
    refetchInterval: options?.refetchInterval,
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      const client: AnyHarnessClient = getAnyHarnessClient(resolveRuntimeConnection(runtime));
      return client.agentGatewayCatalog.getGatewayModels(
        trimmedKind,
        requestOptionsWithSignal(undefined, signal),
      );
    },
  };
}

/**
 * The LOCAL runtime's resolved gateway model plan for one harness kind
 * (contract §5 — the desktop All-Models tab's local+gateway source, read
 * directly from this runtime instead of the cloud catalog).
 */
export function useAgentGatewayModelsQuery(
  kind: string,
  options?: RuntimeQueryOptions,
) {
  const runtime = useAnyHarnessRuntimeContext();
  return useQuery(gatewayModelsQueryOptions(runtime, kind, options));
}

/**
 * The same resolved plan as [`useAgentGatewayModelsQuery`], but for a
 * variable-length set of harness kinds in one hook call (`useQueries`, so the
 * kind count can change across renders without breaking the rules of hooks).
 * Used by the desktop's runtime -> cloud mirror sync (contract §4), which
 * needs to watch every gateway-capable harness for a fresh probe result.
 */
export function useAgentGatewayModelsQueries(
  kinds: readonly string[],
  options?: RuntimeQueryOptions,
) {
  const runtime = useAnyHarnessRuntimeContext();
  return useQueries({
    queries: kinds.map((kind) => gatewayModelsQueryOptions(runtime, kind, options)),
  });
}

/** Re-probes the gateway now (the desktop Refresh button for local+gateway). */
export function useRefreshAgentGatewayModelsMutation() {
  const runtime = useAnyHarnessRuntimeContext();
  const queryClient = useQueryClient();
  const runtimeUrl = runtime.runtimeUrl?.trim() ?? "";
  const cacheScopeKey = resolveRuntimeCacheScopeKey(runtime);

  return useMutation({
    mutationFn: async (kind: string) => {
      const client = getAnyHarnessClient(resolveRuntimeConnection(runtime));
      return client.agentGatewayCatalog.refreshGatewayModels(kind.trim());
    },
    onSuccess: async (_response, kind) => {
      // The refresh endpoint returns bare probed ids; the enriched (catalog-
      // joined) rows come from the gateway-models GET, which reads the same
      // freshly-recorded probe. Invalidate so the next read re-enriches instead
      // of caching a sparse id-only list.
      await queryClient.invalidateQueries({
        queryKey: anyHarnessAgentGatewayModelsKey(runtimeUrl, kind.trim(), cacheScopeKey),
      });
    },
  });
}
