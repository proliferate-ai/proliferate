import { getProliferateClient, type ProliferateCloudClient } from "./core.js";
import type {
  RepoConfigsListResponse,
  RepoEnvironmentResponse,
  SaveCloudRepoEnvironmentRequest,
  SaveLocalRepoEnvironmentRequest,
} from "../types/index.js";

export async function listRepositories(
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<RepoConfigsListResponse> {
  return client.requestJson<RepoConfigsListResponse>({
    method: "GET",
    path: "/v1/cloud/repositories",
  });
}

export async function saveLocalRepoEnvironment(
  gitOwner: string,
  gitRepoName: string,
  body: SaveLocalRepoEnvironmentRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<RepoEnvironmentResponse> {
  return client.requestJson<RepoEnvironmentResponse>({
    method: "PUT",
    path: "/v1/cloud/repositories/{git_owner}/{git_repo_name}/environments/local",
    pathParams: {
      git_owner: gitOwner,
      git_repo_name: gitRepoName,
    },
    body,
  });
}

export async function saveCloudRepoEnvironment(
  gitOwner: string,
  gitRepoName: string,
  body: SaveCloudRepoEnvironmentRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<RepoEnvironmentResponse> {
  return client.requestJson<RepoEnvironmentResponse>({
    method: "PUT",
    path: "/v1/cloud/repositories/{git_owner}/{git_repo_name}/environments/cloud",
    pathParams: {
      git_owner: gitOwner,
      git_repo_name: gitRepoName,
    },
    body,
  });
}
