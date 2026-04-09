import { getProliferateClient } from "./client";
import type { CloudAgentKind, CloudCredentialStatus } from "./client";
import type { components } from "./generated/openapi";

export type SyncClaudeCredentialBody =
  | components["schemas"]["SyncClaudeEnvCredentialRequest"]
  | components["schemas"]["SyncClaudeFileCredentialRequest"];
export type SyncCodexCredentialBody = components["schemas"]["SyncCodexCredentialRequest"];

export async function listCloudCredentialStatuses(): Promise<CloudCredentialStatus[]> {
  return (await getProliferateClient().GET("/v1/cloud/credentials")).data!;
}

export async function syncClaudeCloudCredential(body: SyncClaudeCredentialBody): Promise<void> {
  await getProliferateClient().PUT("/v1/cloud/credentials/claude", { body });
}

export async function syncCodexCloudCredential(body: SyncCodexCredentialBody): Promise<void> {
  await getProliferateClient().PUT("/v1/cloud/credentials/codex", { body });
}

export async function deleteCloudCredential(provider: CloudAgentKind): Promise<void> {
  await getProliferateClient().DELETE("/v1/cloud/credentials/{provider}", {
    params: { path: { provider } },
  });
}
