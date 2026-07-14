import { useQuery } from "@tanstack/react-query";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import {
  discoverDesktopSso,
  type DesktopSsoDiscovery,
} from "@/lib/integrations/auth/proliferate-sso-auth";
import { useControlPlaneHealthFor } from "@/hooks/access/cloud/use-control-plane-health";
import { ssoDiscoveryKey } from "./query-keys";

// `useSsoDiscoveryFor` takes the deployment base URL explicitly so the host
// provider (which builds the host and cannot read it back) can reuse it; the
// public hook derives it from `useProductHost()`.
export function useSsoDiscoveryFor(
  apiBaseUrl: string,
  options?: { email?: string | null; enabled?: boolean },
) {
  const email = options?.email?.trim() || null;
  const { data: controlPlaneReachable = false } = useControlPlaneHealthFor(apiBaseUrl);

  return useQuery<DesktopSsoDiscovery>({
    queryKey: ssoDiscoveryKey(apiBaseUrl, email),
    queryFn: () => discoverDesktopSso({ email, apiBaseUrl }),
    enabled: controlPlaneReachable && (options?.enabled ?? true),
    staleTime: 15_000,
    refetchInterval: 15_000,
    retry: 1,
  });
}

export function useSsoDiscovery(options?: { email?: string | null; enabled?: boolean }) {
  return useSsoDiscoveryFor(useProductHost().deployment.apiBaseUrl, options);
}
