import { CONNECTOR_CATALOG } from "@/config/mcp-catalog";
import type { ConnectorCatalogEntry } from "@/lib/domain/mcp/types";

export function isConnectorCatalogEntryActive(entry: ConnectorCatalogEntry): boolean {
  return entry.mcpServerUrl.trim().length > 0;
}

export function getConnectorAuthStyleLabel(entry: ConnectorCatalogEntry): string {
  return entry.authStyle.kind;
}

export const ACTIVE_CONNECTOR_CATALOG = CONNECTOR_CATALOG.filter(isConnectorCatalogEntryActive);

export function getConnectorCatalogEntry(catalogEntryId: string) {
  return CONNECTOR_CATALOG.find((entry) => entry.id === catalogEntryId) ?? null;
}
