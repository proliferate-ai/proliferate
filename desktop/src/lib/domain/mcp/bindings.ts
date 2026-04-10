import type { SessionMcpEnvVar, SessionMcpServer } from "@anyharness/sdk";
import type {
  ConnectorCatalogEntry,
  ConnectorEnvTemplate,
  ConnectorLaunchResolutionWarning,
  InstalledConnectorRecord,
  StdioConnectorCatalogEntry,
} from "@/lib/domain/mcp/types";

export interface ConnectorLaunchContext {
  targetLocation: "local" | "cloud";
  workspacePath: string | null;
}

export function getConnectorAuthSecretValue(
  catalogEntry: Extract<ConnectorCatalogEntry, { transport: "http" }>,
  secretValues: Record<string, string>,
): string | null {
  return secretValues[catalogEntry.authFieldId] ?? null;
}

function buildConnectorUrl(
  catalogEntry: Extract<ConnectorCatalogEntry, { transport: "http" }>,
  secretValue: string,
): string {
  if (catalogEntry.authStyle.kind !== "query") {
    return catalogEntry.url;
  }
  const url = new URL(catalogEntry.url);
  url.searchParams.set(catalogEntry.authStyle.parameterName, secretValue);
  return url.toString();
}

function buildConnectorHeaders(
  catalogEntry: Extract<ConnectorCatalogEntry, { transport: "http" }>,
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

function resolveStdioArgs(
  catalogEntry: StdioConnectorCatalogEntry,
  launchContext: ConnectorLaunchContext,
): string[] {
  return catalogEntry.args.map((arg) => {
    if (arg.source.kind === "static") {
      return arg.source.value;
    }
    return launchContext.workspacePath ?? "";
  });
}

function resolveStdioEnvVar(
  template: ConnectorEnvTemplate,
  secretValues: Record<string, string>,
): SessionMcpEnvVar {
  if (template.source.kind === "static") {
    return {
      name: template.name,
      value: template.source.value,
    };
  }
  return {
    name: template.name,
    value: secretValues[template.source.fieldId] ?? "",
  };
}

function resolveStdioEnv(
  catalogEntry: StdioConnectorCatalogEntry,
  secretValues: Record<string, string>,
): SessionMcpEnvVar[] {
  return catalogEntry.env.map((template) => resolveStdioEnvVar(template, secretValues));
}

export function buildSessionMcpServer(
  connector: InstalledConnectorRecord,
  input: {
    launchContext: ConnectorLaunchContext;
    secretValues: Record<string, string>;
  },
): SessionMcpServer {
  if (connector.catalogEntry.transport === "http") {
    const secretValue = getConnectorAuthSecretValue(
      connector.catalogEntry,
      input.secretValues,
    ) ?? "";
    return {
      transport: "http",
      connectionId: connector.metadata.connectionId,
      catalogEntryId: connector.catalogEntry.id,
      serverName: connector.metadata.serverName,
      url: buildConnectorUrl(connector.catalogEntry, secretValue),
      headers: buildConnectorHeaders(connector.catalogEntry, secretValue),
    };
  }

  return {
    transport: "stdio",
    connectionId: connector.metadata.connectionId,
    catalogEntryId: connector.catalogEntry.id,
    serverName: connector.metadata.serverName,
    command: connector.catalogEntry.command,
    args: resolveStdioArgs(connector.catalogEntry, input.launchContext),
    env: resolveStdioEnv(connector.catalogEntry, input.secretValues),
  };
}

function buildLaunchWarning(
  connector: InstalledConnectorRecord,
  kind: ConnectorLaunchResolutionWarning["kind"],
): ConnectorLaunchResolutionWarning {
  return {
    kind,
    connectionId: connector.metadata.connectionId,
    catalogEntryId: connector.catalogEntry.id,
    connectorName: connector.catalogEntry.name,
  };
}

export function buildMissingSecretWarning(
  connector: InstalledConnectorRecord,
): ConnectorLaunchResolutionWarning {
  return buildLaunchWarning(connector, "missing_secret");
}

export function buildMissingStdioCommandWarning(
  connector: InstalledConnectorRecord,
): ConnectorLaunchResolutionWarning {
  return buildLaunchWarning(connector, "missing_stdio_command");
}

export function buildWorkspacePathUnresolvedWarning(
  connector: InstalledConnectorRecord,
): ConnectorLaunchResolutionWarning {
  return buildLaunchWarning(connector, "workspace_path_unresolved");
}

export function buildUnsupportedTargetWarning(
  connector: InstalledConnectorRecord,
): ConnectorLaunchResolutionWarning {
  return buildLaunchWarning(connector, "unsupported_target");
}
