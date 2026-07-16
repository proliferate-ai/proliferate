import { useMemo } from "react";
import {
  mergeCloudIntegrations,
  type CloudIntegrationView,
} from "#product/lib/domain/cloud/integrations";
import { useIntegrationActions } from "#product/hooks/access/cloud/integrations/use-integration-actions";
import { useIntegrationCatalog } from "#product/hooks/access/cloud/integrations/use-integration-catalog";
import {
  useIntegrationHealth,
  useInvalidateCloudIntegrations,
} from "#product/hooks/access/cloud/integrations/use-integration-health";
import { useIntegrationOauthFlow } from "#product/hooks/access/cloud/integrations/use-integration-oauth-flow";
import { useCloudAvailabilityState } from "#product/hooks/cloud/derived/use-cloud-availability-state";

export type { CloudIntegrationView };

/**
 * Catalog + health for every integration visible to the user, merged into a
 * single per-definition view the settings pane can render directly.
 *
 * Pass `organizationId` to include the org's custom definitions and policy
 * (membership-guarded server-side); omit it for the personal seeds-only view.
 */
export function useCloudIntegrations(
  organizationId: string | null = null,
  options?: { enabled?: boolean },
) {
  // Integrations are an auth-plane surface: connecting a third-party tool needs
  // only a signed-in control plane, not cloud compute (E2B). Gate on
  // authentication so a local-only / self-hosted user can connect integrations.
  // (The underlying catalog/health hooks already gate on the same signal.)
  const { authStatus } = useCloudAvailabilityState();
  const enabled = authStatus === "authenticated" && (options?.enabled ?? true);

  const catalogQuery = useIntegrationCatalog(organizationId, { enabled });
  const healthQuery = useIntegrationHealth(organizationId, { enabled });

  const integrations = useMemo<CloudIntegrationView[]>(
    () =>
      mergeCloudIntegrations(
        catalogQuery.data?.items ?? [],
        healthQuery.data?.items ?? [],
      ),
    [catalogQuery.data, healthQuery.data],
  );

  return {
    integrations,
    isLoading: catalogQuery.isLoading || healthQuery.isLoading,
    isFetching: catalogQuery.isFetching || healthQuery.isFetching,
    isError: catalogQuery.isError || healthQuery.isError,
    error: catalogQuery.error ?? healthQuery.error,
    catalogQuery,
    healthQuery,
  };
}

/**
 * Connect/disconnect actions plus cache invalidation for the merged view.
 * OAuth handoffs come back through `useCloudIntegrationOauthFlow` polling.
 */
export function useCloudIntegrationActions() {
  const actions = useIntegrationActions();
  const invalidateCloudIntegrations = useInvalidateCloudIntegrations();
  return { ...actions, invalidateCloudIntegrations };
}

/** Poll an in-flight integration OAuth flow; stops on terminal statuses. */
export function useCloudIntegrationOauthFlow(flowId: string | null) {
  return useIntegrationOauthFlow(flowId);
}
