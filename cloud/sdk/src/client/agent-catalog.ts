import { getProliferateClient } from "./core.js";
import type { CloudAgentCatalogResponse } from "../types/index.js";

const AGENT_CATALOG_SCHEMA_VERSION = 1;

export async function getCloudAgentCatalog(): Promise<CloudAgentCatalogResponse> {
  return (
    await getProliferateClient().GET("/v1/catalogs/agents", {
      params: { query: { schemaVersion: AGENT_CATALOG_SCHEMA_VERSION } },
    })
  ).data!;
}
