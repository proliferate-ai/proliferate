import { getProliferateClient } from "./client";
import type {
  CloudAgentKind,
  CloudCredentialMutationResponse,
  CloudCredentialStatus,
} from "./client";
import type { components } from "./generated/openapi";

export interface SyncCloudCredentialBodyByProvider {
  claude:
    | components["schemas"]["SyncClaudeEnvCredentialRequest"]
    | components["schemas"]["SyncClaudeFileCredentialRequest"];
  codex: components["schemas"]["SyncCodexCredentialRequest"];
  gemini:
    | components["schemas"]["SyncGeminiEnvCredentialRequest"]
    | components["schemas"]["SyncGeminiFileCredentialRequest"];
}

export async function listCloudCredentialStatuses(): Promise<CloudCredentialStatus[]> {
  return (await getProliferateClient().GET("/v1/cloud/credentials")).data!;
}

export async function syncCloudCredential<P extends CloudAgentKind>(
  provider: P,
  body: SyncCloudCredentialBodyByProvider[P],
): Promise<CloudCredentialMutationResponse> {
  return (await getProliferateClient().PUT("/v1/cloud/credentials/{provider}", {
    params: { path: { provider } },
    body,
  })).data as CloudCredentialMutationResponse;
}

export async function deleteCloudCredential(
  provider: CloudAgentKind,
): Promise<CloudCredentialMutationResponse> {
  return (await getProliferateClient().DELETE("/v1/cloud/credentials/{provider}", {
    params: { path: { provider } },
  })).data as CloudCredentialMutationResponse;
}
