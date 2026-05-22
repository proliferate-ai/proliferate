import { getProliferateClient } from "./core.js";
import type {
  CloudMcpConnection,
  CloudMcpConnectionsResponse,
  CreateCloudMcpConnectionRequest,
  PatchCloudMcpConnectionRequest,
  PublicizeCloudMcpConnectionRequest,
  PutCloudMcpSecretAuthRequest,
} from "../types/index.js";

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

export async function publicizeCloudMcpConnection(
  connectionId: string,
  body: PublicizeCloudMcpConnectionRequest,
): Promise<CloudMcpConnection> {
  return (await getProliferateClient().POST(
    "/v1/cloud/mcp/connections/{connection_id}/publicize",
    {
      params: { path: { connection_id: connectionId } },
      body,
    },
  )).data!;
}

export async function unpublicizeCloudMcpConnection(
  connectionId: string,
): Promise<CloudMcpConnection> {
  return (await getProliferateClient().POST(
    "/v1/cloud/mcp/connections/{connection_id}/unpublicize",
    {
      params: { path: { connection_id: connectionId } },
    },
  )).data!;
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
