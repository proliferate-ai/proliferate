import { useQuery } from "@tanstack/react-query";
import { useAnyHarnessRuntimeContext, resolveRuntimeConnection } from "../context/AnyHarnessRuntime.js";
import { getAnyHarnessClient } from "../lib/client-cache.js";
import { requestOptionsWithSignal } from "../lib/request-options.js";
import {
  anyHarnessModelRegistriesKey,
  anyHarnessModelRegistryKey,
} from "../lib/query-keys.js";

interface RuntimeQueryOptions {
  enabled?: boolean;
}

interface ModelRegistryQueryOptions extends RuntimeQueryOptions {
  kind?: string | null;
}

export function useModelRegistriesQuery(options?: RuntimeQueryOptions) {
  const runtime = useAnyHarnessRuntimeContext();
  const runtimeUrl = runtime.runtimeUrl?.trim() ?? "";

  return useQuery({
    queryKey: anyHarnessModelRegistriesKey(runtimeUrl),
    enabled: (options?.enabled ?? true) && runtimeUrl.length > 0,
    queryFn: async ({ signal }) => {
      const client = getAnyHarnessClient(resolveRuntimeConnection(runtime));
      return client.modelRegistries.list(requestOptionsWithSignal(undefined, signal));
    },
  });
}

export function useModelRegistryQuery(options?: ModelRegistryQueryOptions) {
  const runtime = useAnyHarnessRuntimeContext();
  const runtimeUrl = runtime.runtimeUrl?.trim() ?? "";
  const kind = options?.kind?.trim() ?? "";

  return useQuery({
    queryKey: anyHarnessModelRegistryKey(runtimeUrl, kind),
    enabled: (options?.enabled ?? true) && runtimeUrl.length > 0 && kind.length > 0,
    queryFn: async ({ signal }) => {
      const client = getAnyHarnessClient(resolveRuntimeConnection(runtime));
      return client.modelRegistries.get(kind, requestOptionsWithSignal(undefined, signal));
    },
  });
}
