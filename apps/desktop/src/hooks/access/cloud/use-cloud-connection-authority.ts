import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { buildAnyHarnessCacheScopeKey } from "@/lib/domain/auth/anyharness-cache-scope";
import { buildCloudConnectionAuthorityScopeKey } from "@/lib/infra/query/cloud-connection-authority";

export function useCloudConnectionAuthority() {
  const host = useProductHost();
  const authStatus = host.auth.state.status === "loading"
    ? "bootstrapping"
    : host.auth.state.status;
  const authUserId = host.auth.state.status === "authenticated"
    ? host.auth.state.user?.id ?? null
    : null;
  const baseScopeKey = buildAnyHarnessCacheScopeKey({
    apiBaseUrl: host.deployment.apiBaseUrl,
    authStatus,
    authUserId,
  });

  return {
    client: host.cloud.client,
    scopeKey: buildCloudConnectionAuthorityScopeKey(
      baseScopeKey,
      host.cloud.client,
    ),
  };
}
