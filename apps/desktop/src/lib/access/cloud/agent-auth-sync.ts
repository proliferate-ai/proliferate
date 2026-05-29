import type {
  SyncSyncedCredentialResponse,
} from "@/lib/access/cloud/client";
import { syncSyncedAgentAuthCredential } from "@proliferate/cloud-sdk/client/agent-auth";
import {
  exportSyncableAgentAuthCredential,
  type AgentAuthProvider,
} from "@/lib/access/tauri/credentials";

export async function syncLocalAgentAuthCredentialToCloud(
  provider: AgentAuthProvider,
): Promise<SyncSyncedCredentialResponse> {
  const exported = await exportSyncableAgentAuthCredential(provider);
  return await syncSyncedAgentAuthCredential(provider, exported);
}
