import { getProliferateClient, type ProliferateCloudClient } from "./core.js";
import type { CloudSandboxResponse } from "../types/generated.js";

export type { CloudSandboxResponse } from "../types/generated.js";

export interface CloudSandboxRepoRuntimeConnectionResponse {
  anyharnessWorkspaceId: string;
  anyharnessRepoRootId: string | null;
  runtimeGeneration: number;
}

export interface CloudSandboxRepoRuntimeConnection {
  gatewayAnyHarnessBaseUrl: string;
  anyharnessWorkspaceId: string;
  anyharnessRepoRootId: string | null;
  runtimeGeneration: number;
}

export type CloudSandboxWorkspaceRuntimeConnectionResponse =
  CloudSandboxRepoRuntimeConnectionResponse;

export type CloudSandboxWorkspaceRuntimeConnection =
  CloudSandboxRepoRuntimeConnection;

export async function getCloudSandbox(
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudSandboxResponse | null> {
  return client.requestJson<CloudSandboxResponse | null>({
    method: "GET",
    path: "/v1/cloud/cloud-sandbox",
  });
}

export async function ensureCloudSandbox(
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudSandboxResponse> {
  return client.requestJson<CloudSandboxResponse>({
    method: "POST",
    path: "/v1/cloud/cloud-sandbox/ensure",
  });
}

export async function wakeCloudSandbox(
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudSandboxResponse> {
  return client.requestJson<CloudSandboxResponse>({
    method: "POST",
    path: "/v1/cloud/cloud-sandbox/wake",
  });
}

export async function destroyCloudSandbox(
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudSandboxResponse | null> {
  const response = await client.requestJson<CloudSandboxResponse | null | undefined>({
    method: "DELETE",
    path: "/v1/cloud/cloud-sandbox",
  });
  return response ?? null;
}

export async function ensureCloudSandboxRepoRuntimeConnection(
  gitOwner: string,
  gitRepoName: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudSandboxRepoRuntimeConnection> {
  const response = await client.requestJson<CloudSandboxRepoRuntimeConnectionResponse>({
    method: "POST",
    path: `/v1/cloud/cloud-sandbox/repos/${encodeURIComponent(gitOwner)}/${encodeURIComponent(
      gitRepoName,
    )}/runtime-connection`,
  });

  return {
    ...response,
    gatewayAnyHarnessBaseUrl: client.buildUrl("/v1/gateway/cloud-sandbox/anyharness"),
  };
}

export async function ensureCloudSandboxWorkspaceRuntimeConnection(
  workspaceId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudSandboxWorkspaceRuntimeConnection> {
  const response = await client.requestJson<CloudSandboxWorkspaceRuntimeConnectionResponse>({
    method: "POST",
    path: `/v1/cloud/cloud-sandbox/workspaces/${encodeURIComponent(
      workspaceId,
    )}/runtime-connection`,
  });

  return {
    ...response,
    gatewayAnyHarnessBaseUrl: client.buildUrl("/v1/gateway/cloud-sandbox/anyharness"),
  };
}
