import { ProliferateClientError } from "@/lib/access/cloud/client";
import {
  listSyncableAgentAuthCredentials,
  type AgentAuthProvider,
} from "@/lib/access/tauri/credentials";

export async function autoSyncDetectedAgentAuthCredentialsIfNeeded(
  error: unknown,
  syncCredential: (provider: AgentAuthProvider) => Promise<unknown>,
): Promise<boolean> {
  if (
    !(error instanceof ProliferateClientError)
    || error.code !== "missing_supported_credentials"
  ) {
    return false;
  }

  const localSources = await listSyncableAgentAuthCredentials().catch(() => []);
  const syncableProviders = Array.from(new Set(localSources
    .filter((source) => source.detected)
    .map((source) => source.provider)));

  if (syncableProviders.length === 0) {
    return false;
  }

  for (const provider of syncableProviders) {
    try {
      await syncCredential(provider);
      return true;
    } catch {
      // Try the next detected provider before giving up on auto-sync.
    }
  }

  return false;
}
