import { getProliferateClient, type ProliferateCloudClient } from "./core.js";

export type CloudSecretsScopeKind = "personal" | "organization" | "workspace";
export type CloudSecretsMaterializationStatus = "pending" | "running" | "ready" | "error";

export interface CloudSecretEnvVarMetadata {
  id: string;
  name: string;
  valueSha256: string;
  byteSize: number;
  updatedAt: string;
}

export interface CloudSecretFileMetadata {
  id: string;
  path: string;
  contentSha256: string;
  byteSize: number;
  updatedAt: string;
}

export interface CloudSecretsMaterialization {
  status: CloudSecretsMaterializationStatus;
  lastError: string | null;
  materializedAt: string | null;
}

export interface CloudSecretsResponse {
  scopeKind: CloudSecretsScopeKind;
  version: number;
  envVars: CloudSecretEnvVarMetadata[];
  files: CloudSecretFileMetadata[];
  materialization: CloudSecretsMaterialization | null;
}

export interface PutCloudSecretEnvVarRequest {
  value: string;
}

export interface PutCloudSecretFileRequest {
  path: string;
  content: string;
}

export interface DeleteCloudSecretFileRequest {
  path: string;
}

function repoSecretsPath(gitOwner: string, gitRepoName: string): string {
  return `/v1/cloud/repos/${encodeURIComponent(gitOwner)}/${encodeURIComponent(gitRepoName)}/secrets`;
}

export async function getPersonalCloudSecrets(
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudSecretsResponse> {
  return client.requestJson<CloudSecretsResponse>({
    method: "GET",
    path: "/v1/cloud/secrets/personal",
  });
}

export async function putPersonalCloudSecretEnvVar(
  name: string,
  body: PutCloudSecretEnvVarRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudSecretsResponse> {
  return client.requestJson<CloudSecretsResponse>({
    method: "PUT",
    path: `/v1/cloud/secrets/personal/env-vars/${encodeURIComponent(name)}`,
    body,
  });
}

export async function deletePersonalCloudSecretEnvVar(
  name: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudSecretsResponse> {
  return client.requestJson<CloudSecretsResponse>({
    method: "DELETE",
    path: `/v1/cloud/secrets/personal/env-vars/${encodeURIComponent(name)}`,
  });
}

export async function putPersonalCloudSecretFile(
  body: PutCloudSecretFileRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudSecretsResponse> {
  return client.requestJson<CloudSecretsResponse>({
    method: "PUT",
    path: "/v1/cloud/secrets/personal/files",
    body,
  });
}

export async function deletePersonalCloudSecretFile(
  body: DeleteCloudSecretFileRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudSecretsResponse> {
  return client.requestJson<CloudSecretsResponse>({
    method: "DELETE",
    path: "/v1/cloud/secrets/personal/files",
    body,
  });
}

export async function getOrganizationCloudSecrets(
  organizationId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudSecretsResponse> {
  return client.requestJson<CloudSecretsResponse>({
    method: "GET",
    path: `/v1/cloud/organizations/${encodeURIComponent(organizationId)}/secrets`,
  });
}

export async function putOrganizationCloudSecretEnvVar(
  organizationId: string,
  name: string,
  body: PutCloudSecretEnvVarRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudSecretsResponse> {
  return client.requestJson<CloudSecretsResponse>({
    method: "PUT",
    path: `/v1/cloud/organizations/${encodeURIComponent(organizationId)}/secrets/env-vars/${encodeURIComponent(name)}`,
    body,
  });
}

export async function deleteOrganizationCloudSecretEnvVar(
  organizationId: string,
  name: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudSecretsResponse> {
  return client.requestJson<CloudSecretsResponse>({
    method: "DELETE",
    path: `/v1/cloud/organizations/${encodeURIComponent(organizationId)}/secrets/env-vars/${encodeURIComponent(name)}`,
  });
}

export async function putOrganizationCloudSecretFile(
  organizationId: string,
  body: PutCloudSecretFileRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudSecretsResponse> {
  return client.requestJson<CloudSecretsResponse>({
    method: "PUT",
    path: `/v1/cloud/organizations/${encodeURIComponent(organizationId)}/secrets/files`,
    body,
  });
}

export async function deleteOrganizationCloudSecretFile(
  organizationId: string,
  body: DeleteCloudSecretFileRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudSecretsResponse> {
  return client.requestJson<CloudSecretsResponse>({
    method: "DELETE",
    path: `/v1/cloud/organizations/${encodeURIComponent(organizationId)}/secrets/files`,
    body,
  });
}

export async function getWorkspaceCloudSecrets(
  gitOwner: string,
  gitRepoName: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudSecretsResponse> {
  return client.requestJson<CloudSecretsResponse>({
    method: "GET",
    path: repoSecretsPath(gitOwner, gitRepoName),
  });
}

export async function putWorkspaceCloudSecretEnvVar(
  gitOwner: string,
  gitRepoName: string,
  name: string,
  body: PutCloudSecretEnvVarRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudSecretsResponse> {
  return client.requestJson<CloudSecretsResponse>({
    method: "PUT",
    path: `${repoSecretsPath(gitOwner, gitRepoName)}/env-vars/${encodeURIComponent(name)}`,
    body,
  });
}

export async function deleteWorkspaceCloudSecretEnvVar(
  gitOwner: string,
  gitRepoName: string,
  name: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudSecretsResponse> {
  return client.requestJson<CloudSecretsResponse>({
    method: "DELETE",
    path: `${repoSecretsPath(gitOwner, gitRepoName)}/env-vars/${encodeURIComponent(name)}`,
  });
}

export async function putWorkspaceCloudSecretFile(
  gitOwner: string,
  gitRepoName: string,
  body: PutCloudSecretFileRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudSecretsResponse> {
  return client.requestJson<CloudSecretsResponse>({
    method: "PUT",
    path: `${repoSecretsPath(gitOwner, gitRepoName)}/files`,
    body,
  });
}

export async function deleteWorkspaceCloudSecretFile(
  gitOwner: string,
  gitRepoName: string,
  body: DeleteCloudSecretFileRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudSecretsResponse> {
  return client.requestJson<CloudSecretsResponse>({
    method: "DELETE",
    path: `${repoSecretsPath(gitOwner, gitRepoName)}/files`,
    body,
  });
}
