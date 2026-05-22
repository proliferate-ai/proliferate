import { getProliferateClient, type ProliferateCloudClient } from "./core.js";
import type {
  CloudRepoConfigResponse,
  CloudRepoConfigsListResponse,
  CloudWorkspaceRepoConfigStatusResponse,
  PutCloudRepoFileRequest,
  RunCloudWorkspaceSetupResponse,
  SaveCloudRepoConfigRequest,
  SaveOrganizationCloudRepoConfigRequest,
  ResyncCloudWorkspaceFilesResponse,
} from "../types/index.js";

export async function listCloudRepoConfigs(
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudRepoConfigsListResponse> {
  return (await client.GET("/v1/cloud/repos/configs")).data!;
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
): Promise<CloudRepoConfigResponse> {
  return (
    await getProliferateClient().GET("/v1/cloud/repos/{git_owner}/{git_repo_name}/config", {
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
): Promise<CloudRepoConfigResponse> {
  return (
    await getProliferateClient().PUT("/v1/cloud/repos/{git_owner}/{git_repo_name}/config", {
      params: { path: { git_owner: gitOwner, git_repo_name: gitRepoName } },
      body,
    })
  ).data!;
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
    await getProliferateClient().PUT("/v1/cloud/repos/{git_owner}/{git_repo_name}/files", {
      params: { path: { git_owner: gitOwner, git_repo_name: gitRepoName } },
      body,
    })
  ).data!;
}

export async function getCloudWorkspaceRepoConfigStatus(
  workspaceId: string,
): Promise<CloudWorkspaceRepoConfigStatusResponse> {
  return (
    await getProliferateClient().GET("/v1/cloud/workspaces/{workspace_id}/repo-config-status", {
      params: { path: { workspace_id: workspaceId } },
    })
  ).data!;
}

export async function resyncCloudWorkspaceFiles(
  workspaceId: string,
): Promise<ResyncCloudWorkspaceFilesResponse> {
  return (
    await getProliferateClient().POST("/v1/cloud/workspaces/{workspace_id}/resync-files", {
      params: { path: { workspace_id: workspaceId } },
    })
  ).data!;
}

export async function runCloudWorkspaceSetup(
  workspaceId: string,
): Promise<RunCloudWorkspaceSetupResponse> {
  return (
    await getProliferateClient().POST("/v1/cloud/workspaces/{workspace_id}/run-setup", {
      params: { path: { workspace_id: workspaceId } },
    })
  ).data!;
}
