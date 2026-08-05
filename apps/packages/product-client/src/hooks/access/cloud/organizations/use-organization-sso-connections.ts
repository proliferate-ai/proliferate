import {
  useOrganizationSsoConnections,
  useOrganizationSsoMutations,
} from "@proliferate/cloud-sdk-react";

export function useOrganizationSsoConnectionsAccess(
  organizationId: string | null,
  enabled: boolean,
) {
  const connectionsQuery = useOrganizationSsoConnections(organizationId, enabled);
  const actions = useOrganizationSsoMutations(organizationId);

  return { connectionsQuery, actions };
}
