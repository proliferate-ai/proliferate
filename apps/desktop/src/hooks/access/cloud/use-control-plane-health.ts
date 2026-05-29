import { useQuery } from "@tanstack/react-query";
import { getProliferateApiBaseUrl } from "@/lib/infra/proliferate-api";
import {
  checkControlPlaneReachable,
  getLastKnownControlPlaneReachable,
} from "@/lib/access/cloud/health";
import { controlPlaneHealthKey } from "./query-keys";

export function useControlPlaneHealth() {
  const apiBaseUrl = getProliferateApiBaseUrl();
  const initialReachable = getLastKnownControlPlaneReachable();

  return useQuery<boolean>({
    queryKey: controlPlaneHealthKey(apiBaseUrl),
    queryFn: checkControlPlaneReachable,
    initialData: initialReachable ?? undefined,
    staleTime: 15_000,
    refetchInterval: 15_000,
    retry: 1,
  });
}
