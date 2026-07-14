import { useMutation, useQuery } from "@tanstack/react-query";
import {
  createAdminIntegrationDefinition,
  listAdminIntegrationDefinitions,
  setAdminIntegrationEnabled,
  type CreateAdminIntegrationDefinitionRequest,
} from "@proliferate/cloud-sdk/client/integrations";
import { ProliferateClientError } from "@/lib/access/cloud/client";
import { requireHostCloudClient } from "@/lib/access/cloud/host-client";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { cloudIntegrationAdminDefinitionsKey } from "./query-keys";
import { useInvalidateCloudIntegrations } from "./use-integration-health";

export function useAdminIntegrationDefinitions(
  organizationId: string | null,
  options?: { enabled?: boolean },
) {
  const host = useProductHost();
  const authStatus = host.auth.state.status;
  const cloudClient = host.cloud.client;
  return useQuery({
    queryKey: cloudIntegrationAdminDefinitionsKey(organizationId),
    enabled:
      authStatus === "authenticated"
      && cloudClient !== null
      && Boolean(organizationId)
      && (options?.enabled ?? true),
    queryFn: () => listAdminIntegrationDefinitions(organizationId!, cloudClient!),
  });
}

export function useAdminIntegrationDefinitionActions(organizationId: string | null) {
  const invalidateCloudIntegrations = useInvalidateCloudIntegrations();
  const cloudClient = useProductHost().cloud.client;

  const createDefinitionMutation = useMutation({
    mutationFn: (input: CreateAdminIntegrationDefinitionRequest) => {
      if (!organizationId) throw new Error("Organization is required.");
      return createAdminIntegrationDefinition(
        organizationId,
        input,
        requireHostCloudClient(cloudClient),
      );
    },
    onSuccess: () => invalidateCloudIntegrations(),
  });

  const setEnabledMutation = useMutation({
    mutationFn: ({ definitionId, enabled }: { definitionId: string; enabled: boolean }) => {
      if (!organizationId) throw new Error("Organization is required.");
      return setAdminIntegrationEnabled(
        organizationId,
        definitionId,
        enabled,
        requireHostCloudClient(cloudClient),
      );
    },
    onSuccess: () => invalidateCloudIntegrations(),
  });

  return {
    createDefinition: createDefinitionMutation.mutateAsync,
    creatingDefinition: createDefinitionMutation.isPending,
    setEnabled: setEnabledMutation.mutateAsync,
    settingEnabled: setEnabledMutation.isPending,
  };
}

/**
 * Human-readable message from an integrations API error, or null when the
 * failure carries none (network faults, unexpected shapes). Lives here so
 * pure presentation modules never touch the access client.
 */
export function integrationApiErrorMessage(error: unknown): string | null {
  return error instanceof ProliferateClientError && error.message ? error.message : null;
}
