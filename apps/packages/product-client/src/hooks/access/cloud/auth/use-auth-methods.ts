import { useQuery } from "@tanstack/react-query";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import {
  getDesktopAuthMethods,
  type DesktopAuthMethods,
} from "#product/lib/access/cloud/auth-probes";
import { useControlPlaneHealthFor } from "#product/hooks/access/cloud/use-control-plane-health";
import { desktopAuthMethodsKey } from "#product/hooks/access/cloud/auth/query-keys";
import { cadence } from "@proliferate/design/cadence";

// Which sign-in methods the connected server offers (public probe). The login
// surface uses this to decide whether the email/password form is the default
// (self-hosted servers without GitHub OAuth) or GitHub stays primary.
//
// `useDesktopAuthMethodsFor` takes the deployment base URL explicitly so the
// host provider (which builds the host and cannot read it back) can reuse it.
export function useDesktopAuthMethodsFor(
  apiBaseUrl: string,
  options?: { enabled?: boolean },
) {
  const { data: controlPlaneReachable = false } = useControlPlaneHealthFor(apiBaseUrl);

  return useQuery<DesktopAuthMethods>({
    queryKey: desktopAuthMethodsKey(apiBaseUrl),
    queryFn: () => getDesktopAuthMethods(apiBaseUrl),
    enabled: controlPlaneReachable && (options?.enabled ?? true),
    // Was raw 15_000ms literals, already exactly `cadence.relaxedMs` (UX
    // Latency + Transitions ADR §4.7, Rung 6, Q8).
    staleTime: cadence.relaxedMs,
    refetchInterval: cadence.relaxedMs,
    retry: 1,
  });
}

export function useDesktopAuthMethods(options?: { enabled?: boolean }) {
  return useDesktopAuthMethodsFor(useProductHost().deployment.apiBaseUrl, options);
}
