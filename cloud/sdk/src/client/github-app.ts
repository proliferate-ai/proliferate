import { getProliferateClient, type ProliferateCloudClient } from "./core.js";
import type { components } from "../generated/openapi.js";

export type GitHubAppConnectResponse = components["schemas"]["GitHubAppConnectResponse"];
export type GitHubAppStatusResponse = components["schemas"]["GitHubAppStatusResponse"];
export type GitHubAppStatusAction = NonNullable<GitHubAppStatusResponse["action"]>;

export interface GetGitHubAppStatusOptions {
  gitOwner?: string | null;
  gitRepoName?: string | null;
}

export interface CreateGitHubAppConnectUrlOptions {
  returnTo?: string | null;
}

export async function createGitHubAppConnectUrl(
  options: CreateGitHubAppConnectUrlOptions = {},
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<GitHubAppConnectResponse> {
  return client.requestJson<GitHubAppConnectResponse>({
    method: "GET",
    path: "/v1/cloud/github-app/connect",
    query: {
      returnTo: options.returnTo,
    },
  });
}

export async function getGitHubAppStatus(
  options: GetGitHubAppStatusOptions = {},
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<GitHubAppStatusResponse> {
  return client.requestJson<GitHubAppStatusResponse>({
    method: "GET",
    path: "/v1/cloud/github-app/status",
    query: {
      gitOwner: options.gitOwner,
      gitRepoName: options.gitRepoName,
    },
  });
}
