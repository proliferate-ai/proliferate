import { getProliferateClient, type ProliferateCloudClient } from "./core.js";
import { legacyOpenApiClient } from "./legacy.js";
import type {
  CloudRepoConfigResponse,
  CloudRepoConfigsListResponse,
  PutCloudRepoFileRequest,
  SaveCloudRepoConfigRequest,
  SaveOrganizationCloudRepoConfigRequest,
} from "../types/index.js";

export async function listCloudRepoConfigs(
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudRepoConfigsListResponse> {
  return (
    await legacyOpenApiClient(client).GET("/v1/cloud/repos/configs")
  ).data!;
}

export async function listOrganizationCloudRepoConfigs(
  organizationId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudRepoConfigsListResponse> {
  return client.requestJson<CloudRepoConfigsListResponse>({
    method: "GET",
    path: "/v1/cloud/organizations/{organization_id}/repos/configs",
    pathParams: { organization_id: organizationId },
  });
}

export async function getCloudRepoConfig(
  gitOwner: string,
  gitRepoName: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudRepoConfigResponse> {
  return (
    await legacyOpenApiClient(client).GET("/v1/cloud/repos/{git_owner}/{git_repo_name}/config", {
      params: { path: { git_owner: gitOwner, git_repo_name: gitRepoName } },
    })
  ).data!;
}

export async function getOrganizationCloudRepoConfig(
  organizationId: string,
  gitOwner: string,
  gitRepoName: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudRepoConfigResponse> {
  return client.requestJson<CloudRepoConfigResponse>({
    method: "GET",
    path: "/v1/cloud/organizations/{organization_id}/repos/{git_owner}/{git_repo_name}/config",
    pathParams: {
      organization_id: organizationId,
      git_owner: gitOwner,
      git_repo_name: gitRepoName,
    },
  });
}

export async function saveCloudRepoConfig(
  gitOwner: string,
  gitRepoName: string,
  body: SaveCloudRepoConfigRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudRepoConfigResponse> {
  return (
    await legacyOpenApiClient(client).PUT("/v1/cloud/repos/{git_owner}/{git_repo_name}/config", {
      params: { path: { git_owner: gitOwner, git_repo_name: gitRepoName } },
      body,
    })
  ).data!;
}

export function buildMinimalCloudRepoConfigRequest(
  defaultBranch: string | null,
): SaveCloudRepoConfigRequest {
  return {
    configured: true,
    defaultBranch,
    setupScript: "",
    runCommand: "",
  };
}

export function buildReenableCloudRepoConfigRequest(
  config: CloudRepoConfigResponse,
  defaultBranch: string | null,
): SaveCloudRepoConfigRequest {
  return {
    configured: true,
    defaultBranch: config.defaultBranch ?? defaultBranch,
    setupScript: config.setupScript ?? "",
    runCommand: config.runCommand ?? "",
  };
}

export async function saveOrganizationCloudRepoConfig(
  organizationId: string,
  gitOwner: string,
  gitRepoName: string,
  body: SaveOrganizationCloudRepoConfigRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudRepoConfigResponse> {
  return client.requestJson<CloudRepoConfigResponse>({
    method: "PUT",
    path: "/v1/cloud/organizations/{organization_id}/repos/{git_owner}/{git_repo_name}/config",
    pathParams: {
      organization_id: organizationId,
      git_owner: gitOwner,
      git_repo_name: gitRepoName,
    },
    body,
  });
}

export async function resyncCloudRepoFileFromLocal(
  gitOwner: string,
  gitRepoName: string,
  body: PutCloudRepoFileRequest,
): Promise<CloudRepoConfigResponse> {
  return (
    await legacyOpenApiClient(getProliferateClient()).PUT("/v1/cloud/repos/{git_owner}/{git_repo_name}/files", {
      params: { path: { git_owner: gitOwner, git_repo_name: gitRepoName } },
      body,
    })
  ).data!;
}
