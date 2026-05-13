import { useQuery } from "@tanstack/react-query";
import type { AnyHarnessRequestOptions } from "@anyharness/sdk";
import { useAnyHarnessRuntimeContext, resolveRuntimeConnection } from "../context/AnyHarnessRuntime.js";
import { getAnyHarnessClient } from "../lib/client-cache.js";
import { anyHarnessRuntimeHealthKey } from "../lib/query-keys.js";
import { requestOptionsWithSignal } from "../lib/request-options.js";

interface RuntimeQueryOptions {
  enabled?: boolean;
  requestOptions?: AnyHarnessRequestOptions;
  refetchInterval?: number | false;
  pollWhileAgentSeedHydrating?: boolean;
}

export function useRuntimeHealthQuery(options?: RuntimeQueryOptions) {
  const runtime = useAnyHarnessRuntimeContext();
  const runtimeUrl = runtime.runtimeUrl?.trim() ?? "";

  return useQuery({
    queryKey: anyHarnessRuntimeHealthKey(runtimeUrl),
    enabled: (options?.enabled ?? true) && runtimeUrl.length > 0,
    queryFn: async ({ signal }) => {
      const client = getAnyHarnessClient(resolveRuntimeConnection(runtime));
      return client.runtime.getHealth(requestOptionsWithSignal(options?.requestOptions, signal));
    },
    refetchInterval: options?.pollWhileAgentSeedHydrating
      ? (query) => (
          query.state.data?.agentSeed?.status === "hydrating" ? 1_000 : false
        )
      : options?.refetchInterval,
  });
}
