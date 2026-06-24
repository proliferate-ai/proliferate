import { getProliferateClient, type ProliferateCloudClient } from "./core.js";

export interface ManagedSandboxResponse {
  id: string;
  ownerScope: string;
  ownerUserId: string | null;
  organizationId: string | null;
  status: string;
  lastError: string | null;
  e2bSandboxId: string | null;
  e2bTemplateRef: string;
  anyharnessBaseUrl: string | null;
  runtimeGeneration: number;
  createdAt: string;
  updatedAt: string;
  readyAt: string | null;
  lastHealthAt: string | null;
  destroyedAt: string | null;
}

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
