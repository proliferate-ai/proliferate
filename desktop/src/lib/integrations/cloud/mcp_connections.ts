import { getProliferateClient } from "./client";
import type {
  CloudMcpConnectionSyncStatus,
  SyncCloudMcpConnectionRequest,
} from "./client";

export async function listCloudMcpConnectionStatuses(): Promise<CloudMcpConnectionSyncStatus[]> {
  return (await getProliferateClient().GET("/v1/cloud/mcp-connections/statuses")).data!;
}

export async function syncCloudMcpConnection(
  connectionId: string,
  body: SyncCloudMcpConnectionRequest,
): Promise<void> {
  await getProliferateClient().PUT("/v1/cloud/mcp-connections/{connection_id}", {
    params: { path: { connection_id: connectionId } },
    body,
  });
}

export async function deleteCloudMcpConnection(connectionId: string): Promise<void> {
  await getProliferateClient().DELETE("/v1/cloud/mcp-connections/{connection_id}", {
    params: { path: { connection_id: connectionId } },
  });
}
