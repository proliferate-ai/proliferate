import { CONNECTOR_CATALOG } from "@/config/mcp-catalog";
import type {
  ConnectorAvailability,
  ConnectorCatalogEntry,
  ConnectorSettings,
  SupabaseConnectorSettings,
} from "@/lib/domain/mcp/types";

export function isConnectorCatalogEntryActive(entry: ConnectorCatalogEntry): boolean {
  if (entry.transport === "http") {
    return entry.url.trim().length > 0;
  }
  return entry.command.trim().length > 0;
}

export function isConnectorCatalogEntryAvailable(
  entry: ConnectorCatalogEntry,
): boolean {
  if (!isConnectorCatalogEntryActive(entry)) {
    return false;
  }
  return entry.id !== "supabase";
}

export function getConnectorAuthStyleLabel(entry: ConnectorCatalogEntry): string {
  if (entry.transport === "http") {
    return entry.authKind === "oauth" ? "oauth" : entry.authStyle?.kind ?? "none";
  }
  return "none";
}

export function getPrimarySecretField(catalogEntry: ConnectorCatalogEntry) {
  if (catalogEntry.transport === "http" && catalogEntry.authKind === "oauth") {
    return null;
  }
  return catalogEntry.requiredFields[0] ?? null;
}

export function connectorSupportsCloudSecretSync(catalogEntry: ConnectorCatalogEntry): boolean {
  return catalogEntry.cloudSecretSync;
}

export function connectorHasMissingSecrets(
  catalogEntry: ConnectorCatalogEntry,
  secretValues: Record<string, string>,
): boolean {
  if (catalogEntry.transport === "http" && catalogEntry.authKind === "oauth") {
    return false;
  }
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

export const ACTIVE_CONNECTOR_CATALOG = CONNECTOR_CATALOG.filter(
  isConnectorCatalogEntryAvailable,
);

export function getConnectorCatalogEntry(catalogEntryId: string) {
  return CONNECTOR_CATALOG.find((entry) => entry.id === catalogEntryId) ?? null;
}

export function isOAuthConnectorCatalogEntry(
  entry: ConnectorCatalogEntry,
): entry is Extract<ConnectorCatalogEntry, { transport: "http"; authKind: "oauth" }> {
  return entry.transport === "http" && entry.authKind === "oauth";
}

export function isSecretHttpConnectorCatalogEntry(
  entry: ConnectorCatalogEntry,
): entry is Extract<ConnectorCatalogEntry, { transport: "http"; authKind: "secret" }> {
  return entry.transport === "http" && entry.authKind === "secret";
}

export function isSupabaseConnectorSettings(
  value: ConnectorSettings | undefined,
): value is SupabaseConnectorSettings {
  return value?.kind === "supabase";
}
