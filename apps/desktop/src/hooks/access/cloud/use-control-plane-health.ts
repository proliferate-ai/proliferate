import { useQuery } from "@tanstack/react-query";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import {
  checkControlPlaneReachable,
  getLastKnownControlPlaneReachable,
} from "@/lib/access/cloud/health";
import { controlPlaneHealthKey } from "./query-keys";

// Core probe keyed on an explicitly-supplied deployment base URL. Callers under
// the host use `useControlPlaneHealth`; the host provider, which builds the host
// and therefore cannot read it back, supplies its own deployment URL here.
export function useControlPlaneHealthFor(apiBaseUrl: string) {
  const initialReachable = getLastKnownControlPlaneReachable();

  return useQuery<boolean>({
    queryKey: controlPlaneHealthKey(apiBaseUrl),
    queryFn: () => checkControlPlaneReachable(apiBaseUrl),
    initialData: initialReachable ?? undefined,
    staleTime: 15_000,
    refetchInterval: 15_000,
    retry: 1,
  });
}

export function useControlPlaneHealth() {
  return useControlPlaneHealthFor(useProductHost().deployment.apiBaseUrl);
}
