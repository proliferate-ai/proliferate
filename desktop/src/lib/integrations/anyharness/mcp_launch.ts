import type { SessionMcpServer } from "@anyharness/sdk";
import {
  buildMissingSecretWarning,
  buildMissingStdioCommandWarning,
  buildSessionMcpServer,
  buildUnsupportedTargetWarning,
  buildWorkspacePathUnresolvedWarning,
  type ConnectorLaunchContext,
} from "@/lib/domain/mcp/bindings";
import {
  connectorHasMissingSecrets,
  connectorSupportsTarget,
  stdioConnectorNeedsWorkspacePath,
} from "@/lib/domain/mcp/catalog";
import type { ConnectorLaunchResolutionWarning } from "@/lib/domain/mcp/types";
import { listInstalledConnectorLaunchRecords } from "@/lib/infra/mcp/state";
import { commandExists } from "@/platform/tauri/process";

export async function resolveSessionMcpServersForLaunch(
  launchContext: ConnectorLaunchContext,
): Promise<{
  mcpServers: SessionMcpServer[];
  warnings: ConnectorLaunchResolutionWarning[];
}> {
  const installed = await listInstalledConnectorLaunchRecords();
  const warnings: ConnectorLaunchResolutionWarning[] = [];
  const mcpServers: SessionMcpServer[] = [];
  const commandAvailabilityCache = new Map<string, boolean>();

  async function commandAvailable(command: string): Promise<boolean> {
    const cached = commandAvailabilityCache.get(command);
    if (cached !== undefined) {
      return cached;
    }
    const available = await commandExists(command);
    commandAvailabilityCache.set(command, available);
    return available;
  }

  for (const { record: connector, secretValues } of installed) {
    if (!connector.metadata.enabled) {
      continue;
    }
    if (!connectorSupportsTarget(connector.catalogEntry, launchContext.targetLocation)) {
      warnings.push(buildUnsupportedTargetWarning(connector));
      continue;
    }
    if (connectorHasMissingSecrets(connector.catalogEntry, secretValues)) {
      warnings.push(buildMissingSecretWarning(connector));
      continue;
    }

    if (connector.catalogEntry.transport === "stdio") {
      if (
        stdioConnectorNeedsWorkspacePath(connector.catalogEntry)
        && !launchContext.workspacePath
      ) {
        warnings.push(buildWorkspacePathUnresolvedWarning(connector));
        continue;
      }
      if (
        launchContext.targetLocation === "local"
        && !await commandAvailable(connector.catalogEntry.command)
      ) {
        warnings.push(buildMissingStdioCommandWarning(connector));
        continue;
      }
    }

    mcpServers.push(buildSessionMcpServer(connector, {
      launchContext,
      secretValues,
    }));
  }

  return {
    mcpServers,
    warnings,
  };
}
