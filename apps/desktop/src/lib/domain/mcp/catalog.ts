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

export function isConnectorCatalogEntryAvailable(
  entry: ConnectorCatalogEntry,
): boolean {
  return isConnectorCatalogEntryActive(entry);
}

export function getConnectorAuthStyleLabel(entry: ConnectorCatalogEntry): string {
  if (entry.transport === "http") {
    if (entry.authKind === "oauth") {
      return "oauth";
    }
    if (entry.authKind === "none") {
      return "none";
    }
    return entry.authStyle?.kind ?? "secret";
  }
  return "none";
}

export function getPrimarySecretField(catalogEntry: ConnectorCatalogEntry) {
  if (
    catalogEntry.transport === "http"
    && (catalogEntry.authKind === "oauth" || catalogEntry.authKind === "none")
  ) {
    return null;
  }
  return (catalogEntry.secretFields[0] ?? catalogEntry.requiredFields[0]) ?? null;
}

export function getConnectorSecretFields(
  catalogEntry: ConnectorCatalogEntry,
) {
  return catalogEntry.secretFields.length > 0
    ? catalogEntry.secretFields
    : catalogEntry.requiredFields;
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
  return getConnectorSecretFields(catalogEntry).some((field) => !secretValues[field.id]);
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

export function isNoAuthHttpConnectorCatalogEntry(
  entry: ConnectorCatalogEntry,
): entry is Extract<ConnectorCatalogEntry, { transport: "http"; authKind: "none" }> {
  return entry.transport === "http" && entry.authKind === "none";
}
