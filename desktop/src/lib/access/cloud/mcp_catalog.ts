import { getProliferateClient } from "./client";
import type { CloudMcpCatalogResponse } from "./client";

export async function getCloudMcpCatalog(): Promise<CloudMcpCatalogResponse> {
  return (await getProliferateClient().GET("/v1/cloud/mcp/catalog")).data!;
}
