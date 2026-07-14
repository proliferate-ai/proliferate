import { useQuery } from "@tanstack/react-query";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import {
  getGitHubDesktopAuthAvailability,
  type GitHubDesktopAuthAvailability,
} from "@/lib/integrations/auth/proliferate-auth";
import {
  useControlPlaneHealthAtApiBaseUrl,
} from "@/hooks/access/cloud/use-control-plane-health";
import { githubDesktopAuthAvailabilityKey } from "./query-keys";

export function useGitHubDesktopAuthAvailabilityAtApiBaseUrl(
  apiBaseUrl: string,
  options?: { enabled?: boolean },
) {
  const { data: controlPlaneReachable = false } =
    useControlPlaneHealthAtApiBaseUrl(apiBaseUrl);

  return useQuery<GitHubDesktopAuthAvailability>({
    queryKey: githubDesktopAuthAvailabilityKey(apiBaseUrl),
    queryFn: () => getGitHubDesktopAuthAvailability(apiBaseUrl),
    enabled: controlPlaneReachable && (options?.enabled ?? true),
    staleTime: 15_000,
    refetchInterval: 15_000,
    retry: 1,
  });
}

export function useGitHubDesktopAuthAvailability(options?: { enabled?: boolean }) {
  const { apiBaseUrl } = useProductHost().deployment;
  return useGitHubDesktopAuthAvailabilityAtApiBaseUrl(apiBaseUrl, options);
}
