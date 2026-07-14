import { useQuery } from "@tanstack/react-query";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import {
  getGitHubDesktopAuthAvailability,
  type GitHubDesktopAuthAvailability,
} from "@/lib/integrations/auth/proliferate-auth";
import { useControlPlaneHealthFor } from "@/hooks/access/cloud/use-control-plane-health";
import { githubDesktopAuthAvailabilityKey } from "./query-keys";

// `useGitHubDesktopAuthAvailabilityFor` takes the deployment base URL explicitly
// so the host provider (which builds the host and cannot read it back) can reuse
// it; the public hook derives it from `useProductHost()`.
export function useGitHubDesktopAuthAvailabilityFor(
  apiBaseUrl: string,
  options?: { enabled?: boolean },
) {
  const { data: controlPlaneReachable = false } = useControlPlaneHealthFor(apiBaseUrl);

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
  return useGitHubDesktopAuthAvailabilityFor(
    useProductHost().deployment.apiBaseUrl,
    options,
  );
}
