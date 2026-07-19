import {
  AnyHarnessRuntime,
  useAnyHarnessCacheScopeKey,
  useAnyHarnessRuntimeContext,
} from "@anyharness/sdk-react";
import { useCallback, type ReactNode } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import {
  cloudSandboxGatewayRuntimeUrl,
  resolveCloudSandboxGatewayRuntimeConnection,
} from "#product/lib/access/cloud/cloud-sandbox-gateway";

/**
 * Rebind AnyHarness runtime hooks to the user's one managed-Cloud sandbox.
 * The gateway credential is resolved for each request; no workspace is used as
 * an installation target or connection surrogate.
 */
export function CloudAnyHarnessRuntimeProvider({
  children,
}: {
  children: ReactNode;
}) {
  const host = useProductHost();
  const parentRuntime = useAnyHarnessRuntimeContext();
  const parentCacheScopeKey = useAnyHarnessCacheScopeKey();
  const cloudClient = host.cloud.client;
  const getAccessToken = host.cloud.getSandboxGatewayAccessToken;
  const runtimeUrl = cloudClient
    ? cloudSandboxGatewayRuntimeUrl(cloudClient)
    : null;
  const resolveConnection = useCallback(async () => {
    if (!cloudClient) {
      throw new Error("Cloud client is unavailable; sign in to connect to Cloud.");
    }
    const connection = await resolveCloudSandboxGatewayRuntimeConnection(
      cloudClient,
      getAccessToken,
    );
    return {
      ...connection,
      ...(parentRuntime.fetch ? { fetch: parentRuntime.fetch } : {}),
    };
  }, [cloudClient, getAccessToken, parentRuntime.fetch]);

  return (
    <AnyHarnessRuntime
      runtimeUrl={runtimeUrl}
      cacheScopeKey={parentCacheScopeKey}
      resolveConnection={resolveConnection}
    >
      {children}
    </AnyHarnessRuntime>
  );
}
