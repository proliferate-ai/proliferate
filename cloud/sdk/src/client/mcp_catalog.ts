import { getProliferateClient } from "./core";
import type { CloudMcpCatalogResponse } from "../types";

export async function getCloudMcpCatalog(): Promise<CloudMcpCatalogResponse> {
  return (await getProliferateClient().GET("/v1/cloud/mcp/catalog")).data!;
}
