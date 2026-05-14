import { getProliferateClient } from "./core";
import type { CloudRepoBranchesResponse } from "../types";

export async function listCloudRepoBranches(
  gitOwner: string,
  gitRepoName: string,
): Promise<CloudRepoBranchesResponse> {
  return (
    await getProliferateClient().GET(
      "/v1/cloud/repos/{git_owner}/{git_repo_name}/branches",
      { params: { path: { git_owner: gitOwner, git_repo_name: gitRepoName } } },
    )
  ).data!;
}
