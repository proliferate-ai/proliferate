import { useMemo } from "react";
import { useIntegrationHealth } from "@/hooks/access/cloud/integrations/use-integration-health";
import { useCloudAvailabilityState } from "@/hooks/cloud/derived/use-cloud-availability-state";
import { useActiveOrganization } from "@/hooks/organizations/facade/use-active-organization";
import {
  integrationReauthChipLabel,
  integrationsNeedingReauth,
} from "@/lib/domain/cloud/integration-reauth";

/** Quiet background cadence: reauth is not urgent enough to poll aggressively. */
const REAUTH_REFRESH_INTERVAL_MS = 5 * 60_000;

export interface IntegrationReauthState {
  /** Display names of connected providers reporting `needs_reauth`. */
  providerNames: string[];
  /** Chip copy; null when every connected provider is healthy. */
  label: string | null;
  /** Render the chip only when this is true. */
  visible: boolean;
}

// Owns the composer-facing "providers needing reauth" model derived from
// integration health. Does not own connect/reconnect actions (settings pane).
export function useIntegrationReauthState(): IntegrationReauthState {
  const { cloudActive } = useCloudAvailabilityState();
  const { activeOrganizationId } = useActiveOrganization();
  const healthQuery = useIntegrationHealth(activeOrganizationId, {
    enabled: cloudActive,
    refetchInterval: REAUTH_REFRESH_INTERVAL_MS,
    refetchOnWindowFocus: true,
  });

  const items = healthQuery.data?.items;
  return useMemo<IntegrationReauthState>(() => {
    const providerNames = integrationsNeedingReauth(items ?? [])
      .map((item) => item.displayName);
    const label = integrationReauthChipLabel(providerNames);
    return { providerNames, label, visible: label !== null };
  }, [items]);
}
