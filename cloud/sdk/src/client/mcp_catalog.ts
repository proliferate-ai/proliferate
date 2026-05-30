import { getProliferateClient, type ProliferateCloudClient } from "./core.js";
import type { CloudMcpCatalogResponse } from "../types/index.js";

export async function getCloudMcpCatalog(
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudMcpCatalogResponse> {
  return (await client.GET("/v1/cloud/mcp/catalog")).data!;
}
