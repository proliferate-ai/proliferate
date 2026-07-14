import { useQuery } from "@tanstack/react-query";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { fetchServerCapabilities } from "@/lib/access/cloud/server-capabilities";
import type { ServerCapabilityContract } from "@/lib/domain/capabilities/server-capability-contract";
import { serverCapabilitiesKey } from "./query-keys";

/**
 * The connected control plane's self-host capability contract (`GET /meta`).
 *
 * `null` data means the server declared no contract (older server) — callers
 * degrade conservatively. Keyed by API base URL so switching servers refetches.
 */
export function useServerCapabilitiesAtApiBaseUrl(apiBaseUrl: string) {
  return useQuery<ServerCapabilityContract | null>({
    queryKey: serverCapabilitiesKey(apiBaseUrl),
    queryFn: () => fetchServerCapabilities(apiBaseUrl),
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: 1,
  });
}

export function useServerCapabilities() {
  const { apiBaseUrl } = useProductHost().deployment;
  return useServerCapabilitiesAtApiBaseUrl(apiBaseUrl);
}
