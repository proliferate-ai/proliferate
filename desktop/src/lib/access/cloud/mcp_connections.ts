import { getProliferateClient } from "./client";
import type {
  CloudMcpConnection,
  CloudMcpConnectionsResponse,
  CloudMcpConnectionSyncStatus,
  CreateCloudMcpConnectionRequest,
  PatchCloudMcpConnectionRequest,
  PutCloudMcpSecretAuthRequest,
  SyncCloudMcpConnectionRequest,
} from "./client";

export async function listCloudMcpConnections(): Promise<CloudMcpConnectionsResponse> {
  return (await getProliferateClient().GET("/v1/cloud/mcp/connections")).data!;
}

export async function createCloudMcpConnection(
  body: CreateCloudMcpConnectionRequest,
): Promise<CloudMcpConnection> {
  return (await getProliferateClient().POST("/v1/cloud/mcp/connections", { body })).data!;
}

export async function patchCloudMcpConnection(
  connectionId: string,
  body: PatchCloudMcpConnectionRequest,
): Promise<CloudMcpConnection> {
  return (await getProliferateClient().PATCH("/v1/cloud/mcp/connections/{connection_id}", {
    params: { path: { connection_id: connectionId } },
    body,
  })).data!;
}

export async function putCloudMcpSecretAuth(
  connectionId: string,
  body: PutCloudMcpSecretAuthRequest,
): Promise<CloudMcpConnection> {
  return (await getProliferateClient().PUT(
    "/v1/cloud/mcp/connections/{connection_id}/auth/secret",
    {
      params: { path: { connection_id: connectionId } },
      body,
    },
  )).data!;
}

export async function deleteCloudMcpConnectionV2(connectionId: string): Promise<void> {
  await getProliferateClient().DELETE("/v1/cloud/mcp/connections/{connection_id}", {
    params: { path: { connection_id: connectionId } },
  });
}

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
