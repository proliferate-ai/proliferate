import type {
  SessionMcpBindingNotAppliedReason,
  SessionMcpBindingSummary,
  SessionMcpServer,
} from "@anyharness/sdk";
import {
  buildMissingSecretWarning,
  buildMissingStdioCommandWarning,
  buildNeedsReconnectWarning,
  buildResolverErrorWarning,
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
import type {
  ConnectorLaunchResolutionWarning,
  InstalledConnectorRecord,
} from "@/lib/domain/mcp/types";
import { listInstalledConnectorLaunchRecords } from "@/lib/infra/mcp/state";
import { commandExists } from "@/platform/tauri/process";
import { getValidOAuthAccessToken } from "@/platform/tauri/mcp-oauth";

export interface SessionMcpLaunchPolicy {
  workspaceSurface: "coding" | "cowork";
  lifecycle: "create" | "resume";
  enabled: boolean;
  includePolicyDisabledSummaries?: boolean;
}

export interface SessionMcpLaunchRequest extends ConnectorLaunchContext {
  policy: SessionMcpLaunchPolicy;
}

export async function resolveSessionMcpServersForLaunch(
  launchContext: SessionMcpLaunchRequest,
): Promise<{
  mcpServers: SessionMcpServer[];
  mcpBindingSummaries?: SessionMcpBindingSummary[];
  warnings: ConnectorLaunchResolutionWarning[];
}> {
  const installed = await listInstalledConnectorLaunchRecords();
  const warnings: ConnectorLaunchResolutionWarning[] = [];
  const mcpServers: SessionMcpServer[] = [];
  const mcpBindingSummaries: SessionMcpBindingSummary[] = [];
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

  if (!launchContext.policy.enabled) {
    if (launchContext.policy.includePolicyDisabledSummaries) {
      for (const { record: connector } of installed) {
        if (!connector.metadata.enabled) {
          continue;
        }
        mcpBindingSummaries.push(buildSummary(connector, {
          outcome: "not_applied",
          reason: "policy_disabled",
        }));
      }
    }
    return {
      mcpServers,
      mcpBindingSummaries: mcpBindingSummaries.length > 0 ? mcpBindingSummaries : undefined,
      warnings,
    };
  }

  const resolutions = await Promise.all(installed.map(async ({ record: connector, secretValues }) => {
    if (!connector.metadata.enabled) {
      return null;
    }
    try {
      if (!connectorSupportsTarget(connector.catalogEntry, launchContext.targetLocation)) {
        return {
          mcpServer: null,
          summary: buildSummary(connector, {
            outcome: "not_applied",
            reason: "unsupported_target",
          }),
          warning: buildUnsupportedTargetWarning(connector),
        };
      }
      if (isOAuthConnectorCatalogEntry(connector.catalogEntry)) {
        if (validateOAuthConnectorSettings(connector.catalogEntry, connector.metadata.settings)) {
          return {
            mcpServer: null,
            summary: buildSummary(connector, {
              outcome: "not_applied",
              reason: "needs_reconnect",
            }),
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
            summary: buildSummary(connector, {
              outcome: "not_applied",
              reason: "needs_reconnect",
            }),
            warning: buildNeedsReconnectWarning(connector),
          };
        }
        if (tokenResult.kind !== "ready") {
          return {
            mcpServer: null,
            summary: buildSummary(connector, {
              outcome: "not_applied",
              reason: "needs_reconnect",
            }),
            warning: buildNeedsReconnectWarning(connector),
          };
        }
        return {
          mcpServer: buildSessionMcpServer(connector, {
            launchContext,
            secretValues,
            oauthAccessToken: tokenResult.accessToken,
          }),
          summary: buildSummary(connector, { outcome: "applied" }),
          warning: null,
        };
      }
      if (connectorHasMissingSecrets(connector.catalogEntry, secretValues)) {
        return {
          mcpServer: null,
          summary: buildSummary(connector, {
            outcome: "not_applied",
            reason: "missing_secret",
          }),
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
            summary: buildSummary(connector, {
              outcome: "not_applied",
              reason: "workspace_path_unresolved",
            }),
            warning: buildWorkspacePathUnresolvedWarning(connector),
          };
        }
        if (
          launchContext.targetLocation === "local"
          && !await commandAvailable(connector.catalogEntry.command)
        ) {
          return {
            mcpServer: null,
            summary: buildSummary(connector, {
              outcome: "not_applied",
              reason: "resolver_error",
            }),
            warning: buildMissingStdioCommandWarning(connector),
          };
        }
      }

      return {
        mcpServer: buildSessionMcpServer(connector, {
          launchContext,
          secretValues,
        }),
        summary: buildSummary(connector, { outcome: "applied" }),
        warning: null,
      };
    } catch {
      return {
        mcpServer: null,
        summary: buildSummary(connector, {
          outcome: "not_applied",
          reason: "resolver_error",
        }),
        warning: buildResolverErrorWarning(connector),
      };
    }
  }));

  for (const resolution of resolutions) {
    if (!resolution) {
      continue;
    }
    if (resolution.warning) {
      warnings.push(resolution.warning);
    }
    if (resolution.summary) {
      mcpBindingSummaries.push(resolution.summary);
    }
    if (resolution.mcpServer) {
      mcpServers.push(resolution.mcpServer);
    }
  }

  return {
    mcpServers,
    mcpBindingSummaries: mcpBindingSummaries.length > 0 ? mcpBindingSummaries : undefined,
    warnings,
  };
}

function buildSummary(
  connector: InstalledConnectorRecord,
  input: {
    outcome: "applied" | "not_applied";
    reason?: SessionMcpBindingNotAppliedReason;
  },
): SessionMcpBindingSummary {
  return {
    id: connector.metadata.connectionId,
    serverName: connector.metadata.serverName,
    displayName: connector.catalogEntry.name,
    transport: connector.catalogEntry.transport,
    outcome: input.outcome,
    ...(input.reason ? { reason: input.reason } : {}),
  };
}
