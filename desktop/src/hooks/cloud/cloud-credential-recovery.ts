import type { CloudAgentKind } from "@/lib/access/cloud/client";
import { isCloudAgentKind, ProliferateClientError } from "@/lib/access/cloud/client";
import { listSyncableCloudCredentials } from "@/platform/tauri/credentials";

export async function autoSyncDetectedCloudCredentialsIfNeeded(
  error: unknown,
  syncCredential: (provider: CloudAgentKind) => Promise<unknown>,
): Promise<boolean> {
  if (
    !(error instanceof ProliferateClientError)
    || error.code !== "missing_supported_credentials"
  ) {
    return false;
  }

  const localSources = await listSyncableCloudCredentials().catch(() => []);
  const syncableProviders = Array.from(new Set(localSources
    .filter((source): source is typeof source & { provider: CloudAgentKind } => (
      source.detected && isCloudAgentKind(source.provider)
    ))
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
