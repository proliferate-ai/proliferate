import type { SessionMcpServer } from "@anyharness/sdk";
import {
  buildMissingSecretWarning,
  buildMissingStdioCommandWarning,
  buildNeedsReconnectWarning,
  buildSessionMcpServer,
  buildUnsupportedTargetWarning,
  buildWorkspacePathUnresolvedWarning,
  type ConnectorLaunchContext,
} from "@/lib/domain/mcp/bindings";
import {
  connectorHasMissingSecrets,
  connectorSupportsTarget,
  isOAuthConnectorCatalogEntry,
  stdioConnectorNeedsWorkspacePath,
} from "@/lib/domain/mcp/catalog";
import { validateOAuthConnectorSettings } from "@/lib/domain/mcp/oauth";
import type { ConnectorLaunchResolutionWarning } from "@/lib/domain/mcp/types";
import { listInstalledConnectorLaunchRecords } from "@/lib/infra/mcp/state";
import { commandExists } from "@/platform/tauri/process";
import { getValidOAuthAccessToken } from "@/platform/tauri/mcp-oauth";

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

  const resolutions = await Promise.all(installed.map(async ({ record: connector, secretValues }) => {
    if (!connector.metadata.enabled) {
      return null;
    }
    if (!connectorSupportsTarget(connector.catalogEntry, launchContext.targetLocation)) {
      return {
        mcpServer: null,
        warning: buildUnsupportedTargetWarning(connector),
      };
    }
    if (isOAuthConnectorCatalogEntry(connector.catalogEntry)) {
      if (validateOAuthConnectorSettings(connector.catalogEntry, connector.metadata.settings)) {
        return {
          mcpServer: null,
          warning: buildNeedsReconnectWarning(connector),
        };
      }
      let tokenResult;
      try {
        tokenResult = await getValidOAuthAccessToken({
          connectionId: connector.metadata.connectionId,
          minRemainingSeconds: 60,
        });
      } catch {
        return {
          mcpServer: null,
          warning: buildNeedsReconnectWarning(connector),
        };
      }
      if (tokenResult.kind !== "ready") {
        return {
          mcpServer: null,
          warning: buildNeedsReconnectWarning(connector),
        };
      }
      return {
        mcpServer: buildSessionMcpServer(connector, {
          launchContext,
          secretValues,
          oauthAccessToken: tokenResult.accessToken,
        }),
        warning: null,
      };
    }
    if (connectorHasMissingSecrets(connector.catalogEntry, secretValues)) {
      return {
        mcpServer: null,
        warning: buildMissingSecretWarning(connector),
      };
    }

    if (connector.catalogEntry.transport === "stdio") {
      if (
        stdioConnectorNeedsWorkspacePath(connector.catalogEntry)
        && !launchContext.workspacePath
      ) {
        return {
          mcpServer: null,
          warning: buildWorkspacePathUnresolvedWarning(connector),
        };
      }
      if (
        launchContext.targetLocation === "local"
        && !await commandAvailable(connector.catalogEntry.command)
      ) {
        return {
          mcpServer: null,
          warning: buildMissingStdioCommandWarning(connector),
        };
      }
    }

    return {
      mcpServer: buildSessionMcpServer(connector, {
        launchContext,
        secretValues,
      }),
      warning: null,
    };
  }));

  for (const resolution of resolutions) {
    if (!resolution) {
      continue;
    }
    if (resolution.warning) {
      warnings.push(resolution.warning);
    }
    if (resolution.mcpServer) {
      mcpServers.push(resolution.mcpServer);
    }
  }

  return {
    mcpServers,
    warnings,
  };
}
