import { getProliferateClient, type ProliferateCloudClient } from "./core.js";
import type {
  CloudOrganizationIntegrationPolicyResponse,
  PatchCloudOrganizationIntegrationPolicyRequest,
} from "../types/index.js";

export async function getCloudOrganizationIntegrationPolicy(
  organizationId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudOrganizationIntegrationPolicyResponse> {
  return (await client.GET("/v1/cloud/organizations/{organization_id}/integration-policy", {
    params: { path: { organization_id: organizationId } },
  })).data!;
}

export async function patchCloudOrganizationIntegrationPolicy(
  organizationId: string,
  body: PatchCloudOrganizationIntegrationPolicyRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudOrganizationIntegrationPolicyResponse> {
  return (await client.PATCH("/v1/cloud/organizations/{organization_id}/integration-policy", {
    params: { path: { organization_id: organizationId } },
    body,
  })).data!;
}
