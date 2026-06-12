import { getProliferateClient, type ProliferateCloudClient } from "./core.js";
import type { CloudAgentCatalogResponse } from "../types/index.js";

const AGENT_CATALOG_SCHEMA_VERSION = 2;

export async function getCloudAgentCatalog(
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudAgentCatalogResponse> {
  return (
    await client.GET("/v1/catalogs/agents", {
      params: { query: { schemaVersion: AGENT_CATALOG_SCHEMA_VERSION } },
    })
  ).data!;
}
