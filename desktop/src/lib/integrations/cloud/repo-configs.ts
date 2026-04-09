import { getProliferateClient } from "./client";
import type {
  CloudRepoConfigResponse,
  CloudRepoConfigsListResponse,
  CloudWorkspaceRepoConfigStatusResponse,
  PutCloudRepoFileRequest,
  RunCloudWorkspaceSetupResponse,
  SaveCloudRepoConfigRequest,
  ResyncCloudWorkspaceFilesResponse,
} from "./client";

export async function listCloudRepoConfigs(): Promise<CloudRepoConfigsListResponse> {
  return (await getProliferateClient().GET("/v1/cloud/repos/configs")).data!;
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
