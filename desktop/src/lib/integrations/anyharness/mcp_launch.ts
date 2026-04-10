import type { SessionMcpServer } from "@anyharness/sdk";
import {
  buildMissingSecretWarning,
  buildSessionMcpServer,
  getConnectorAuthSecretValue,
} from "@/lib/domain/mcp/bindings";
import type { ConnectorLaunchResolutionWarning } from "@/lib/domain/mcp/types";
import {
  connectorHasMissingSecrets,
  listInstalledConnectorLaunchRecords,
} from "@/lib/infra/mcp/state";

export async function resolveSessionMcpServersForLaunch(
): Promise<{
  mcpServers: SessionMcpServer[];
  warnings: ConnectorLaunchResolutionWarning[];
}> {
  const installed = await listInstalledConnectorLaunchRecords();
  const warnings: ConnectorLaunchResolutionWarning[] = [];
  const mcpServers: SessionMcpServer[] = [];

  for (const { record: connector, secretValues } of installed) {
    if (!connector.metadata.enabled) {
      continue;
    }
    if (connectorHasMissingSecrets(connector.catalogEntry, secretValues)) {
      warnings.push(buildMissingSecretWarning(connector));
      continue;
    }
    const secretValue = getConnectorAuthSecretValue(connector.catalogEntry, secretValues);
    if (!secretValue) {
      warnings.push(buildMissingSecretWarning(connector));
      continue;
    }
    mcpServers.push(buildSessionMcpServer(connector, secretValue));
  }

  return {
    mcpServers,
    warnings,
  };
}
