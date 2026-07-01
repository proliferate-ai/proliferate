import { getProliferateClient, type ProliferateCloudClient } from "./core.js";
import type { components } from "../generated/openapi.js";
import type { CloudGitRepositoriesResponse } from "../types/index.js";

export type GitHubAppUserAuthorizationStartResponse =
  components["schemas"]["GitHubAppUserAuthorizationStartResponse"];
export type GitHubAppUserAuthorizationStatusResponse =
  components["schemas"]["GitHubAppUserAuthorizationStatusResponse"];
export type GitHubAppUserAuthorizationStatusAction =
  NonNullable<GitHubAppUserAuthorizationStatusResponse["action"]>;
export type GitHubAppInstallationStartResponse =
  components["schemas"]["GitHubAppInstallationStartResponse"];
export type GitHubAppInstallationStatusResponse =
  components["schemas"]["GitHubAppInstallationStatusResponse"];
export type GitHubAppInstallationStatusAction =
  NonNullable<GitHubAppInstallationStatusResponse["action"]>;
export type GitHubRepoAuthorityResponse =
  components["schemas"]["GitHubRepoAuthorityResponse"];
export type GitHubRepoAuthorityStatus =
  GitHubRepoAuthorityResponse["status"];
export type GitHubRepoAuthorityAction =
  NonNullable<GitHubRepoAuthorityResponse["action"]>;

export interface StartGitHubAppUserAuthorizationOptions {
  returnTo?: string | null;
}

export interface StartGitHubAppInstallationOptions {
  returnTo?: string | null;
}

export interface ListGitHubAppAccessibleReposOptions {
  query?: string | null;
  cursor?: string | null;
  limit?: number;
  affiliation?: string;
  visibility?: string;
}

export async function startGitHubAppUserAuthorization(
  options: StartGitHubAppUserAuthorizationOptions = {},
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<GitHubAppUserAuthorizationStartResponse> {
  return client.requestJson<GitHubAppUserAuthorizationStartResponse>({
    method: "GET",
    path: "/v1/cloud/github-app/user-authorization/start",
    query: {
      returnTo: options.returnTo,
    },
  });
}

export async function getGitHubAppUserAuthorizationStatus(
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<GitHubAppUserAuthorizationStatusResponse> {
  return client.requestJson<GitHubAppUserAuthorizationStatusResponse>({
    method: "GET",
    path: "/v1/cloud/github-app/user-authorization",
  });
}

export async function startGitHubAppInstallation(
  organizationId: string,
  options: StartGitHubAppInstallationOptions = {},
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<GitHubAppInstallationStartResponse> {
  return client.requestJson<GitHubAppInstallationStartResponse>({
    method: "GET",
    path: "/v1/cloud/organizations/{organization_id}/github-app/installation/start",
    pathParams: {
      organization_id: organizationId,
    },
    query: {
      returnTo: options.returnTo,
    },
  });
}

export async function getGitHubAppInstallationStatus(
  organizationId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<GitHubAppInstallationStatusResponse> {
  return client.requestJson<GitHubAppInstallationStatusResponse>({
    method: "GET",
    path: "/v1/cloud/organizations/{organization_id}/github-app/installation",
    pathParams: {
      organization_id: organizationId,
    },
  });
}

export async function getGitHubRepoAuthority(
  gitOwner: string,
  gitRepoName: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<GitHubRepoAuthorityResponse> {
  return client.requestJson<GitHubRepoAuthorityResponse>({
    method: "GET",
    path: "/v1/cloud/github-app/repos/{git_owner}/{git_repo_name}/authority",
    pathParams: {
      git_owner: gitOwner,
      git_repo_name: gitRepoName,
    },
  });
}

export async function listGitHubAppAccessibleRepos(
  options: ListGitHubAppAccessibleReposOptions = {},
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudGitRepositoriesResponse> {
  return client.requestJson<CloudGitRepositoriesResponse>({
    method: "GET",
    path: "/v1/cloud/github-app/accessible-repos",
    query: {
      query: options.query,
      cursor: options.cursor,
      limit: options.limit,
      affiliation: options.affiliation,
      visibility: options.visibility,
    },
  });
}
