import { getProliferateClient, type ProliferateCloudClient } from "./core.js";
import type {
  CloudGitRepositoriesResponse,
  CloudRepoBranchesResponse,
} from "../types/index.js";

export interface ListCloudGitRepositoriesOptions {
  query?: string | null;
  cursor?: string | null;
  limit?: number;
  affiliation?: string;
  visibility?: string;
}

export async function listCloudGitRepositories(
  options: ListCloudGitRepositoriesOptions = {},
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudGitRepositoriesResponse> {
  return (
    await client.GET("/v1/cloud/repos", {
      params: {
        query: {
          query: options.query,
          cursor: options.cursor,
          limit: options.limit,
          affiliation: options.affiliation,
          visibility: options.visibility,
        },
      },
    })
  ).data!;
}

export async function listCloudRepoBranches(
  gitOwner: string,
  gitRepoName: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudRepoBranchesResponse> {
  return (
    await client.GET("/v1/cloud/repos/{git_owner}/{git_repo_name}/branches", {
      params: { path: { git_owner: gitOwner, git_repo_name: gitRepoName } },
    })
  ).data!;
}
