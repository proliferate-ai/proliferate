import { getProliferateClient, type ProliferateCloudClient } from "./core.js";
import { listIntegrationDefinitions } from "./integrations.js";
import type {
  CloudOrganizationIntegrationPolicyResponse,
  PatchCloudOrganizationIntegrationPolicyRequest,
} from "../types/index.js";

export async function getCloudOrganizationIntegrationPolicy(
  organizationId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudOrganizationIntegrationPolicyResponse> {
  const definitions = await listIntegrationDefinitions({ organizationId }, client);
  return {
    organizationId,
    entries: definitions.map((definition) => ({
      catalogEntryId: definition.id,
      enabled: true,
      updatedAt: null,
      updatedByUserId: null,
    })),
  };
}

export async function patchCloudOrganizationIntegrationPolicy(
  organizationId: string,
  body: PatchCloudOrganizationIntegrationPolicyRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudOrganizationIntegrationPolicyResponse> {
  const policy = await getCloudOrganizationIntegrationPolicy(organizationId, client);
  return {
    organizationId,
    entries: policy.entries.map((entry) =>
      entry.catalogEntryId === body.catalogEntryId
        ? { ...entry, enabled: body.enabled, updatedAt: new Date().toISOString() }
        : entry
    ),
  };
}
