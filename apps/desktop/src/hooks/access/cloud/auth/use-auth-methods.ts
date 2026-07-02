import { useQuery } from "@tanstack/react-query";
import { getProliferateApiBaseUrl } from "@/lib/infra/proliferate-api";
import {
  getDesktopAuthMethods,
  type DesktopAuthMethods,
} from "@/lib/integrations/auth/proliferate-auth-password";
import { useControlPlaneHealth } from "@/hooks/access/cloud/use-control-plane-health";
import { desktopAuthMethodsKey } from "./query-keys";

// Which sign-in methods the connected server offers (public probe). The login
// surface uses this to decide whether the email/password form is the default
// (self-hosted servers without GitHub OAuth) or GitHub stays primary.
export function useDesktopAuthMethods(options?: { enabled?: boolean }) {
  const apiBaseUrl = getProliferateApiBaseUrl();
  const { data: controlPlaneReachable = false } = useControlPlaneHealth();

  return useQuery<DesktopAuthMethods>({
    queryKey: desktopAuthMethodsKey(apiBaseUrl),
    queryFn: getDesktopAuthMethods,
    enabled: controlPlaneReachable && (options?.enabled ?? true),
    staleTime: 15_000,
    refetchInterval: 15_000,
    retry: 1,
  });
}
