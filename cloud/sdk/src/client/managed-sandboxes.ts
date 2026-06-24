import { getProliferateClient, type ProliferateCloudClient } from "./core.js";
import type { ManagedSandboxResponse } from "../types/generated.js";

export type { ManagedSandboxResponse } from "../types/generated.js";

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
