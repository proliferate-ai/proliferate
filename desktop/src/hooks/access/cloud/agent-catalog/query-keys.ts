import { cloudRootKey } from "@/hooks/access/cloud/query-keys";

export function cloudAgentCatalogKey() {
  return [...cloudRootKey(), "catalogs", "agents", "v1"] as const;
}
