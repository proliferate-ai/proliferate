import { useQuery } from "@tanstack/react-query";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import {
  checkControlPlaneReachable,
  getLastKnownControlPlaneReachable,
} from "@/lib/access/cloud/health";
import { controlPlaneHealthKey } from "./query-keys";

export function useControlPlaneHealthAtApiBaseUrl(apiBaseUrl: string) {
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
  const { apiBaseUrl } = useProductHost().deployment;
  return useControlPlaneHealthAtApiBaseUrl(apiBaseUrl);
}
