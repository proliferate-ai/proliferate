import type { SessionMcpServer } from "@anyharness/sdk";
import type {
  ConnectorCatalogEntry,
  ConnectorLaunchResolutionWarning,
  InstalledConnectorRecord,
} from "@/lib/domain/mcp/types";

export function getConnectorAuthSecretValue(
  catalogEntry: ConnectorCatalogEntry,
  secretValues: Record<string, string>,
): string | null {
  return secretValues[catalogEntry.authFieldId] ?? null;
}

function buildConnectorUrl(
  catalogEntry: ConnectorCatalogEntry,
  secretValue: string,
): string {
  if (catalogEntry.authStyle.kind !== "query") {
    return catalogEntry.mcpServerUrl;
  }
  const url = new URL(catalogEntry.mcpServerUrl);
  url.searchParams.set(catalogEntry.authStyle.parameterName, secretValue);
  return url.toString();
}

function buildConnectorHeaders(
  catalogEntry: ConnectorCatalogEntry,
  secretValue: string,
) {
  if (catalogEntry.authStyle.kind === "bearer") {
    return [{ name: "Authorization", value: `Bearer ${secretValue}` }];
  }
  if (catalogEntry.authStyle.kind === "header") {
    return [{ name: catalogEntry.authStyle.headerName, value: secretValue }];
  }
  return [];
}

export function buildSessionMcpServer(
  connector: InstalledConnectorRecord,
  secretValue: string,
): SessionMcpServer {
  return {
    transport: "http",
    connectionId: connector.metadata.connectionId,
    catalogEntryId: connector.catalogEntry.id,
    serverName: connector.metadata.serverName,
    url: buildConnectorUrl(connector.catalogEntry, secretValue),
    headers: buildConnectorHeaders(connector.catalogEntry, secretValue),
  };
}

export function buildMissingSecretWarning(
  connector: InstalledConnectorRecord,
): ConnectorLaunchResolutionWarning {
  return {
    kind: "missing_secret",
    connectionId: connector.metadata.connectionId,
    catalogEntryId: connector.catalogEntry.id,
    connectorName: connector.catalogEntry.name,
  };
}
