import { useMemo } from "react";
import { useIntegrationHealth } from "#product/hooks/access/cloud/integrations/use-integration-health";
import { useCloudAvailabilityState } from "#product/hooks/cloud/derived/use-cloud-availability-state";
import { useActiveOrganization } from "#product/hooks/organizations/facade/use-active-organization";
import {
  deriveComposerIntegrationsModel,
  type ComposerIntegrationsModel,
} from "#product/lib/domain/cloud/composer-integrations";

export type { ComposerIntegrationsModel };

/**
 * Quiet background cadence: integration health is not urgent enough to poll
 * aggressively.
 *
 * Named exception (does not sit on the `cadence` scale): 5 minutes is longer
 * than even `cadence.slowMs` (60s), the scale's largest token — the same
 * shape as `CLOUD_AGENT_CATALOG_STALE_MS`. Integration health (connected /
 * degraded / disconnected) changes on the order of a provider outage or a
 * user revoking access, not per-session, and `refetchOnWindowFocus` already
 * covers the case where the user returns to a stale tab, so a stale time an
 * order of magnitude beyond `slow` is intentional (UX Latency + Transitions
 * ADR §4.7, Rung 6, Q8).
 */
const HEALTH_REFRESH_INTERVAL_MS = 5 * 60_000;

/**
 * Composer-facing view of the user's connected integrations, escalating from
 * hidden -> quiet -> urgent. Reads the shared integration-health query (deduped
 * with the settings pane by react-query) rather than fetching anew; owns no
 * connect/reconnect actions, which live in the settings pane.
 */
export function useComposerIntegrationsState(): ComposerIntegrationsModel {
  const { cloudActive } = useCloudAvailabilityState();
  const { activeOrganizationId } = useActiveOrganization();
  const healthQuery = useIntegrationHealth(activeOrganizationId, {
    enabled: cloudActive,
    refetchInterval: HEALTH_REFRESH_INTERVAL_MS,
    refetchOnWindowFocus: true,
  });

  const items = healthQuery.data?.items;
  return useMemo(() => deriveComposerIntegrationsModel(items ?? []), [items]);
}
