import { getProliferateClient, type ProliferateCloudClient } from "./core.js";
import type { CloudSandboxResponse } from "../types/generated.js";

export type { CloudSandboxResponse } from "../types/generated.js";

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
