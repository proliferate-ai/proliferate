import { useQuery } from "@tanstack/react-query";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import {
  getGitHubDesktopAuthAvailability,
  type GitHubDesktopAuthAvailability,
} from "#product/lib/access/cloud/auth-probes";
import { useControlPlaneHealthFor } from "#product/hooks/access/cloud/use-control-plane-health";
import { githubDesktopAuthAvailabilityKey } from "#product/hooks/access/cloud/auth/query-keys";
import { cadence } from "@proliferate/design/cadence";

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
    // Was raw 15_000ms literals, already exactly `cadence.relaxedMs` (UX
    // Latency + Transitions ADR §4.7, Rung 6, Q8).
    staleTime: cadence.relaxedMs,
    refetchInterval: cadence.relaxedMs,
    retry: 1,
  });
}

export function useGitHubDesktopAuthAvailability(options?: { enabled?: boolean }) {
  return useGitHubDesktopAuthAvailabilityFor(
    useProductHost().deployment.apiBaseUrl,
    options,
  );
}
