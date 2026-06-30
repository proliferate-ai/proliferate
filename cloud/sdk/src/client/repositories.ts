import { getProliferateClient, type ProliferateCloudClient } from "./core.js";
import type {
  RepoConfigsListResponse,
  RepoEnvironmentResponse,
  SaveRepoEnvironmentRequest,
} from "../types/index.js";

export async function listRepositories(
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<RepoConfigsListResponse> {
  return client.requestJson<RepoConfigsListResponse>({
    method: "GET",
    path: "/v1/cloud/repositories",
  });
}

export async function saveRepoEnvironment(
  gitOwner: string,
  gitRepoName: string,
  body: SaveRepoEnvironmentRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<RepoEnvironmentResponse> {
  return client.requestJson<RepoEnvironmentResponse>({
    method: "PUT",
    path: "/v1/cloud/repositories/{git_owner}/{git_repo_name}/environment",
    pathParams: {
      git_owner: gitOwner,
      git_repo_name: gitRepoName,
    },
    body,
  });
}
