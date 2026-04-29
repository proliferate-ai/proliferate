import type { CloudAgentKind } from "@/lib/integrations/cloud/client";
import { syncCloudCredential } from "@/lib/integrations/cloud/credentials";
import { exportSyncableCloudCredential } from "@/platform/tauri/credentials";

export async function syncLocalCloudCredentialToCloud(
  provider: CloudAgentKind,
): Promise<void> {
  const exported = await exportSyncableCloudCredential(provider);
  await syncCloudCredential(provider, exported);
}
