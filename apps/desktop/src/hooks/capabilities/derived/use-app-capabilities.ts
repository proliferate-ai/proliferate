import { useMemo } from "react";
import { PROLIFERATE_PRICING_URL, SUPPORT_EMAIL_ADDRESS } from "@/config/capabilities";
import { useServerCapabilities } from "@/hooks/access/cloud/server-capabilities/use-server-capabilities";
import { useControlPlaneHealth } from "@/hooks/access/cloud/use-control-plane-health";
import {
  type AppCapabilities,
  deriveAppCapabilities,
  resolveEffectiveContract,
} from "@/lib/domain/capabilities/app-capabilities";
import {
  getProliferateApiBaseUrl,
  isOfficialHostedApiBaseUrl,
} from "@/lib/infra/proliferate-api";

function connectedServerHost(): string | null {
  try {
    return new URL(getProliferateApiBaseUrl()).host || null;
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
export function useAppCapabilities(): AppCapabilities {
  const { data: reachable = false } = useControlPlaneHealth();
  const { data: contract = null } = useServerCapabilities();
  const isOfficialOrigin = isOfficialHostedApiBaseUrl();
  const host = connectedServerHost();

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
