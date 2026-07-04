import { getProliferateClient, type ProliferateCloudClient } from "./core.js";

export interface OrgSandboxProfileResponse {
  id: string;
  organizationId: string;
  displayName: string | null;
  status: string;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  readyAt: string | null;
}

export interface OrgSandboxProfileListResponse {
  profiles: OrgSandboxProfileResponse[];
}

export interface CreateOrgSandboxProfileInput {
  displayName: string;
}

export async function listOrgSandboxProfiles(
  organizationId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<OrgSandboxProfileListResponse> {
  return client.requestJson<OrgSandboxProfileListResponse>({
    method: "GET",
    path: `/v1/cloud/organizations/${organizationId}/sandbox-profiles`,
  });
}

export async function createOrgSandboxProfile(
  organizationId: string,
  input: CreateOrgSandboxProfileInput,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<OrgSandboxProfileResponse> {
  return client.requestJson<OrgSandboxProfileResponse>({
    method: "POST",
    path: `/v1/cloud/organizations/${organizationId}/sandbox-profiles`,
    body: input,
  });
}

export async function getOrgSandboxProfile(
  organizationId: string,
  sandboxId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<OrgSandboxProfileResponse> {
  return client.requestJson<OrgSandboxProfileResponse>({
    method: "GET",
    path: `/v1/cloud/organizations/${organizationId}/sandbox-profiles/${sandboxId}`,
  });
}
