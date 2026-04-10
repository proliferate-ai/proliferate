import { useQuery } from "@tanstack/react-query";
import { getProliferateApiBaseUrl } from "@/lib/infra/proliferate-api";
import { isGitHubDesktopAuthAvailable } from "@/lib/integrations/auth/proliferate-auth";
import { useControlPlaneHealth } from "@/hooks/cloud/use-control-plane-health";
import { githubDesktopAuthAvailabilityKey } from "./query-keys";

export function useGitHubDesktopAuthAvailability() {
  const apiBaseUrl = getProliferateApiBaseUrl();
  const { data: controlPlaneReachable = false } = useControlPlaneHealth();

  return useQuery<boolean>({
    queryKey: githubDesktopAuthAvailabilityKey(apiBaseUrl),
    queryFn: isGitHubDesktopAuthAvailable,
    enabled: controlPlaneReachable,
    staleTime: 15_000,
    refetchInterval: 15_000,
    retry: 1,
  });
}
