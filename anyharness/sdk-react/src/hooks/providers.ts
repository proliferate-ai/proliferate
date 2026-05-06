import { useQuery } from "@tanstack/react-query";
import { useAnyHarnessRuntimeContext, resolveRuntimeConnection } from "../context/AnyHarnessRuntime.js";
import { getAnyHarnessClient } from "../lib/client-cache.js";
import { anyHarnessProviderConfigsKey } from "../lib/query-keys.js";
import { requestOptionsWithSignal } from "../lib/request-options.js";

interface RuntimeQueryOptions {
  enabled?: boolean;
}

export function useProviderConfigsQuery(options?: RuntimeQueryOptions) {
  const runtime = useAnyHarnessRuntimeContext();
  const runtimeUrl = runtime.runtimeUrl?.trim() ?? "";

  return useQuery({
    queryKey: anyHarnessProviderConfigsKey(runtimeUrl),
    enabled: (options?.enabled ?? true) && runtimeUrl.length > 0,
    queryFn: async ({ signal }) => {
      const client = getAnyHarnessClient(resolveRuntimeConnection(runtime));
      return client.providers.listConfigs(requestOptionsWithSignal(undefined, signal));
    },
  });
}
