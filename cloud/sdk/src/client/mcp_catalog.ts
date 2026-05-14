import { getProliferateClient } from "./core.js";
import type { CloudMcpCatalogResponse } from "../types/index.js";

export async function getCloudMcpCatalog(): Promise<CloudMcpCatalogResponse> {
  return (await getProliferateClient().GET("/v1/cloud/mcp/catalog")).data!;
}
