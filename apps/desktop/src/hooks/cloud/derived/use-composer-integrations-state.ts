import { useMemo } from "react";
import { useIntegrationHealth } from "@/hooks/access/cloud/integrations/use-integration-health";
import { useCloudAvailabilityState } from "@/hooks/cloud/derived/use-cloud-availability-state";
import { useActiveOrganization } from "@/hooks/organizations/facade/use-active-organization";
import {
  deriveComposerIntegrationsModel,
  type ComposerIntegrationsModel,
} from "@/lib/domain/cloud/composer-integrations";

export type { ComposerIntegrationsModel };

/** Quiet background cadence: integration health is not urgent enough to poll aggressively. */
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
