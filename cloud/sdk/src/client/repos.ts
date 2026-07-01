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
  return client.requestJson<CloudGitRepositoriesResponse>({
    method: "GET",
    path: "/v1/cloud/repositories/catalog",
    query: {
      query: options.query,
      cursor: options.cursor,
      limit: options.limit,
      affiliation: options.affiliation,
      visibility: options.visibility,
    },
  });
}

export async function listCloudRepoBranches(
  gitOwner: string,
  gitRepoName: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudRepoBranchesResponse> {
  return client.requestJson<CloudRepoBranchesResponse>({
    method: "GET",
    path: "/v1/cloud/repositories/{git_owner}/{git_repo_name}/branches",
    pathParams: {
      git_owner: gitOwner,
      git_repo_name: gitRepoName,
    },
  });
}
