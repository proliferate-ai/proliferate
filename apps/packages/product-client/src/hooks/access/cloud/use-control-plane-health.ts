import { useQuery } from "@tanstack/react-query";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import {
  checkControlPlaneReachable,
  getLastKnownControlPlaneReachable,
} from "#product/lib/access/cloud/health";
import { controlPlaneHealthKey } from "#product/hooks/access/cloud/query-keys";
import { cadence } from "@proliferate/design/cadence";

// Core probe keyed on an explicitly-supplied deployment base URL. Callers under
// the host use `useControlPlaneHealth`; the host provider, which builds the host
// and therefore cannot read it back, supplies its own deployment URL here.
export function useControlPlaneHealthFor(apiBaseUrl: string) {
  const initialReachable = getLastKnownControlPlaneReachable();

  return useQuery<boolean>({
    queryKey: controlPlaneHealthKey(apiBaseUrl),
    queryFn: () => checkControlPlaneReachable(apiBaseUrl),
    initialData: initialReachable ?? undefined,
    // Was raw 15_000ms literals, already exactly `cadence.relaxedMs` (UX
    // Latency + Transitions ADR §4.7, Rung 6, Q8).
    staleTime: cadence.relaxedMs,
    refetchInterval: cadence.relaxedMs,
    retry: 1,
  });
}

export function useControlPlaneHealth() {
  return useControlPlaneHealthFor(useProductHost().deployment.apiBaseUrl);
}
