import { useMemo } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { PROLIFERATE_PRICING_URL, SUPPORT_EMAIL_ADDRESS } from "@/config/capabilities";
import { useServerCapabilitiesFor } from "@/hooks/access/cloud/server-capabilities/use-server-capabilities";
import { useControlPlaneHealthFor } from "@/hooks/access/cloud/use-control-plane-health";
import {
  type AppCapabilities,
  deriveAppCapabilities,
  resolveEffectiveContract,
} from "@/lib/domain/capabilities/app-capabilities";
import { isOfficialHostedApiBaseUrl } from "@/lib/infra/proliferate-api";

function connectedServerHost(apiBaseUrl: string): string | null {
  try {
    return new URL(apiBaseUrl).host || null;
  } catch {
    return null;
  }
}

/**
 * App-wide capability state, derived from the server-declared capability
 * contract rather than mere reachability. A self-managed server exposes only
 * the capabilities its operator configured; an older server (no contract) that
 * is the official hosted product keeps the current hosted posture, and any
 * other older server degrades conservatively.
 *
 * `useAppCapabilitiesFor` takes the deployment base URL explicitly so the host
 * provider (which builds the host and cannot read it back) can reuse it.
 */
export function useAppCapabilitiesFor(apiBaseUrl: string): AppCapabilities {
  const { data: reachable = false } = useControlPlaneHealthFor(apiBaseUrl);
  const { data: contract = null } = useServerCapabilitiesFor(apiBaseUrl);
  const isOfficialOrigin = isOfficialHostedApiBaseUrl(apiBaseUrl);
  const host = connectedServerHost(apiBaseUrl);

  return useMemo(() => {
    const effective = resolveEffectiveContract(contract, {
      isOfficialOrigin,
      fallback: {
        supportEmail: SUPPORT_EMAIL_ADDRESS,
        pricingUrl: PROLIFERATE_PRICING_URL,
      },
    });
    return deriveAppCapabilities({
      reachable,
      contract: effective,
      connectedServerHost: host,
    });
  }, [reachable, contract, isOfficialOrigin, host]);
}

export function useAppCapabilities(): AppCapabilities {
  return useAppCapabilitiesFor(useProductHost().deployment.apiBaseUrl);
}
