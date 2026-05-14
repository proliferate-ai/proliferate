import { cloudRootKey } from "@/hooks/access/cloud/query-keys";

export function cloudAgentCatalogKey() {
  return [...cloudRootKey(), "desktop-launch-catalog", "agents", "v1"] as const;
}
