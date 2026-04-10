import { CONNECTOR_CATALOG } from "@/config/mcp-catalog";
import type {
  ConnectorAvailability,
  ConnectorCatalogEntry,
} from "@/lib/domain/mcp/types";

export function isConnectorCatalogEntryActive(entry: ConnectorCatalogEntry): boolean {
  if (entry.transport === "http") {
    return entry.url.trim().length > 0;
  }
  return entry.command.trim().length > 0;
}

export function getConnectorAuthStyleLabel(entry: ConnectorCatalogEntry): string {
  if (entry.transport === "http") {
    return entry.authStyle.kind;
  }
  return "none";
}

export function getPrimarySecretField(catalogEntry: ConnectorCatalogEntry) {
  return catalogEntry.requiredFields[0] ?? null;
}

export function connectorSupportsCloudSecretSync(catalogEntry: ConnectorCatalogEntry): boolean {
  return catalogEntry.cloudSecretSync;
}

export function connectorHasMissingSecrets(
  catalogEntry: ConnectorCatalogEntry,
  secretValues: Record<string, string>,
): boolean {
  return catalogEntry.requiredFields.some((field) => !secretValues[field.id]);
}

export function connectorSupportsTarget(
  catalogEntry: ConnectorCatalogEntry,
  targetLocation: "local" | "cloud",
): boolean {
  const availabilityByTarget: Record<ConnectorAvailability, readonly ("local" | "cloud")[]> = {
    universal: ["local", "cloud"],
    local_only: ["local"],
    cloud_only: ["cloud"],
  };
  return availabilityByTarget[catalogEntry.availability].includes(targetLocation);
}

export function stdioConnectorNeedsWorkspacePath(catalogEntry: ConnectorCatalogEntry): boolean {
  return catalogEntry.transport === "stdio"
    && catalogEntry.args.some((arg) => arg.source.kind === "workspace_path");
}

export const ACTIVE_CONNECTOR_CATALOG = CONNECTOR_CATALOG.filter(isConnectorCatalogEntryActive);

export function getConnectorCatalogEntry(catalogEntryId: string) {
  return CONNECTOR_CATALOG.find((entry) => entry.id === catalogEntryId) ?? null;
}
