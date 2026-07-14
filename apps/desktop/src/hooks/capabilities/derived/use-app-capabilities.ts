import { useMemo } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { PROLIFERATE_PRICING_URL, SUPPORT_EMAIL_ADDRESS } from "@/config/capabilities";
import {
  useServerCapabilitiesAtApiBaseUrl,
} from "@/hooks/access/cloud/server-capabilities/use-server-capabilities";
import {
  useControlPlaneHealthAtApiBaseUrl,
} from "@/hooks/access/cloud/use-control-plane-health";
import {
  type AppCapabilities,
  deriveAppCapabilities,
  resolveEffectiveContract,
} from "@/lib/domain/capabilities/app-capabilities";
import {
  isOfficialHostedApiBaseUrl,
} from "@/lib/infra/proliferate-api";

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
 */
export function useAppCapabilitiesAtApiBaseUrl(apiBaseUrl: string): AppCapabilities {
  const { data: reachable = false } =
    useControlPlaneHealthAtApiBaseUrl(apiBaseUrl);
  const { data: contract = null } =
    useServerCapabilitiesAtApiBaseUrl(apiBaseUrl);
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
  const { apiBaseUrl } = useProductHost().deployment;
  return useAppCapabilitiesAtApiBaseUrl(apiBaseUrl);
}
