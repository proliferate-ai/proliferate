import type {
  CloudAgentKind,
  CloudCredentialMutationResponse,
} from "@/lib/integrations/cloud/client";
import { syncCloudCredential } from "@/lib/integrations/cloud/credentials";
import { exportSyncableCloudCredential } from "@/platform/tauri/credentials";

export async function syncLocalCloudCredentialToCloud(
  provider: CloudAgentKind,
): Promise<CloudCredentialMutationResponse> {
  const exported = await exportSyncableCloudCredential(provider);
  return await syncCloudCredential(provider, exported);
}
