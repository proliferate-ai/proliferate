import { getProliferateClient, type ProliferateCloudClient } from "./core.js";
import type { ManagedSandboxResponse } from "../types/generated.js";

export type { ManagedSandboxResponse } from "../types/generated.js";

export interface ManagedSandboxRepoRuntimeConnectionResponse {
  anyharnessWorkspaceId: string;
  anyharnessRepoRootId: string | null;
  runtimeGeneration: number;
}

export interface ManagedSandboxRepoRuntimeConnection {
  gatewayAnyHarnessBaseUrl: string;
  anyharnessWorkspaceId: string;
  anyharnessRepoRootId: string | null;
  runtimeGeneration: number;
}

export type ManagedSandboxWorkspaceRuntimeConnectionResponse =
  ManagedSandboxRepoRuntimeConnectionResponse;

export type ManagedSandboxWorkspaceRuntimeConnection =
  ManagedSandboxRepoRuntimeConnection;

export async function getManagedSandbox(
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<ManagedSandboxResponse | null> {
  return client.requestJson<ManagedSandboxResponse | null>({
    method: "GET",
    path: "/v1/cloud/managed-sandbox",
  });
}

export async function ensureManagedSandbox(
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<ManagedSandboxResponse> {
  return client.requestJson<ManagedSandboxResponse>({
    method: "POST",
    path: "/v1/cloud/managed-sandbox/ensure",
  });
}

export async function wakeManagedSandbox(
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<ManagedSandboxResponse> {
  return client.requestJson<ManagedSandboxResponse>({
    method: "POST",
    path: "/v1/cloud/managed-sandbox/wake",
  });
}

export async function destroyManagedSandbox(
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<ManagedSandboxResponse | null> {
  return client.requestJson<ManagedSandboxResponse | null>({
    method: "DELETE",
    path: "/v1/cloud/managed-sandbox",
  });
}

export async function ensureManagedSandboxRepoRuntimeConnection(
  gitOwner: string,
  gitRepoName: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<ManagedSandboxRepoRuntimeConnection> {
  const response = await client.requestJson<ManagedSandboxRepoRuntimeConnectionResponse>({
    method: "POST",
    path: `/v1/cloud/managed-sandbox/repos/${encodeURIComponent(gitOwner)}/${encodeURIComponent(
      gitRepoName,
    )}/runtime-connection`,
  });

  return {
    ...response,
    gatewayAnyHarnessBaseUrl: client.buildUrl("/v1/gateway/managed-sandbox/anyharness"),
  };
}

export async function ensureManagedSandboxWorkspaceRuntimeConnection(
  workspaceId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<ManagedSandboxWorkspaceRuntimeConnection> {
  const response = await client.requestJson<ManagedSandboxWorkspaceRuntimeConnectionResponse>({
    method: "POST",
    path: `/v1/cloud/managed-sandbox/workspaces/${encodeURIComponent(
      workspaceId,
    )}/runtime-connection`,
  });

  return {
    ...response,
    gatewayAnyHarnessBaseUrl: client.buildUrl("/v1/gateway/managed-sandbox/anyharness"),
  };
}
