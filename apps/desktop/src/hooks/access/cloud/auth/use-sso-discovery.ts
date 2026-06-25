import { useQuery } from "@tanstack/react-query";
import { getProliferateApiBaseUrl } from "@/lib/infra/proliferate-api";
import {
  discoverDesktopSso,
  type DesktopSsoDiscovery,
} from "@/lib/integrations/auth/proliferate-sso-auth";
import { useControlPlaneHealth } from "@/hooks/access/cloud/use-control-plane-health";
import { ssoDiscoveryKey } from "./query-keys";

export function useSsoDiscovery(options?: { email?: string | null; enabled?: boolean }) {
  const apiBaseUrl = getProliferateApiBaseUrl();
  const email = options?.email?.trim() || null;
  const { data: controlPlaneReachable = false } = useControlPlaneHealth();

  return useQuery<DesktopSsoDiscovery>({
    queryKey: ssoDiscoveryKey(apiBaseUrl, email),
    queryFn: () => discoverDesktopSso({ email }),
    enabled: controlPlaneReachable && (options?.enabled ?? true),
    staleTime: 15_000,
    refetchInterval: 15_000,
    retry: 1,
  });
}
