import { getProliferateClient, type ProliferateCloudClient } from "./core.js";
import { legacyOpenApiClient } from "./legacy.js";
import type {
  CloudMcpConnection,
  CloudMcpConnectionsResponse,
  CreateCloudMcpConnectionRequest,
  PatchCloudMcpConnectionRequest,
  PublicizeCloudMcpConnectionRequest,
  PutCloudMcpSecretAuthRequest,
} from "../types/index.js";

export async function listCloudMcpConnections(
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudMcpConnectionsResponse> {
  return (await legacyOpenApiClient(client).GET("/v1/cloud/mcp/connections")).data!;
}

export async function createCloudMcpConnection(
  body: CreateCloudMcpConnectionRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudMcpConnection> {
  return (await legacyOpenApiClient(client).POST("/v1/cloud/mcp/connections", { body })).data!;
}

export async function patchCloudMcpConnection(
  connectionId: string,
  body: PatchCloudMcpConnectionRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudMcpConnection> {
  return (await legacyOpenApiClient(client).PATCH("/v1/cloud/mcp/connections/{connection_id}", {
    params: { path: { connection_id: connectionId } },
    body,
  })).data!;
}

export async function publicizeCloudMcpConnection(
  connectionId: string,
  body: PublicizeCloudMcpConnectionRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudMcpConnection> {
  return (await legacyOpenApiClient(client).POST(
    "/v1/cloud/mcp/connections/{connection_id}/publicize",
    {
      params: { path: { connection_id: connectionId } },
      body,
    },
  )).data!;
}

export async function unpublicizeCloudMcpConnection(
  connectionId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudMcpConnection> {
  return (await legacyOpenApiClient(client).POST(
    "/v1/cloud/mcp/connections/{connection_id}/unpublicize",
    {
      params: { path: { connection_id: connectionId } },
    },
  )).data!;
}

export async function putCloudMcpSecretAuth(
  connectionId: string,
  body: PutCloudMcpSecretAuthRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudMcpConnection> {
  return (await legacyOpenApiClient(client).PUT(
    "/v1/cloud/mcp/connections/{connection_id}/auth/secret",
    {
      params: { path: { connection_id: connectionId } },
      body,
    },
  )).data!;
}

export async function deleteCloudMcpConnectionV2(
  connectionId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<void> {
  await legacyOpenApiClient(client).DELETE("/v1/cloud/mcp/connections/{connection_id}", {
    params: { path: { connection_id: connectionId } },
  });
}
