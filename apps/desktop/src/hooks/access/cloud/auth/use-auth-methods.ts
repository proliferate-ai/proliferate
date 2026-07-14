import { useQuery } from "@tanstack/react-query";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import {
  getDesktopAuthMethods,
  type DesktopAuthMethods,
} from "@/lib/integrations/auth/proliferate-auth-password";
import {
  useControlPlaneHealthAtApiBaseUrl,
} from "@/hooks/access/cloud/use-control-plane-health";
import { desktopAuthMethodsKey } from "./query-keys";

// Which sign-in methods the connected server offers (public probe). The login
// surface uses this to decide whether the email/password form is the default
// (self-hosted servers without GitHub OAuth) or GitHub stays primary.
export function useDesktopAuthMethodsAtApiBaseUrl(
  apiBaseUrl: string,
  options?: { enabled?: boolean },
) {
  const { data: controlPlaneReachable = false } =
    useControlPlaneHealthAtApiBaseUrl(apiBaseUrl);

  return useQuery<DesktopAuthMethods>({
    queryKey: desktopAuthMethodsKey(apiBaseUrl),
    queryFn: () => getDesktopAuthMethods(apiBaseUrl),
    enabled: controlPlaneReachable && (options?.enabled ?? true),
    staleTime: 15_000,
    refetchInterval: 15_000,
    retry: 1,
  });
}

export function useDesktopAuthMethods(options?: { enabled?: boolean }) {
  const { apiBaseUrl } = useProductHost().deployment;
  return useDesktopAuthMethodsAtApiBaseUrl(apiBaseUrl, options);
}
