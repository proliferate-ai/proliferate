import type {
  SessionMcpBindingSummary,
  SessionMcpServer,
} from "@anyharness/sdk";
import { finalizeLocalStdioCandidates } from "@/lib/domain/mcp/local-stdio-finalizer";
import type { ConnectorLaunchResolutionWarning } from "@/lib/domain/mcp/types";
import { materializeCloudMcpServers } from "@/lib/integrations/cloud/mcp_materialization";

export interface ConnectorLaunchContext {
  targetLocation: "local" | "cloud";
  workspacePath: string | null;
}

export interface SessionMcpLaunchPolicy {
  workspaceSurface: "coding" | "cowork";
  lifecycle: "create" | "resume";
  enabled: boolean;
  includePolicyDisabledSummaries?: boolean;
}

export interface SessionMcpLaunchRequest extends ConnectorLaunchContext {
  policy: SessionMcpLaunchPolicy;
}

export const COWORK_WORKSPACE_PATH_PLACEHOLDER =
  "__PROLIFERATE_COWORK_WORKSPACE_PATH__";

export async function resolveSessionMcpServersForLaunch(
  launchContext: SessionMcpLaunchRequest,
): Promise<{
  mcpServers: SessionMcpServer[];
  mcpBindingSummaries: SessionMcpBindingSummary[];
  warnings: ConnectorLaunchResolutionWarning[];
}> {
  if (!launchContext.policy.enabled) {
    return {
      mcpServers: [],
      mcpBindingSummaries: [],
      warnings: [],
    };
  }

  const materialized = await materializeCloudMcpServers({
    targetLocation: launchContext.targetLocation,
  });
  const finalizedStdio = await finalizeLocalStdioCandidates(
    materialized.localStdioCandidates,
    { workspacePath: launchContext.workspacePath },
  );
  const finalizedStdioIds = new Set(
    materialized.localStdioCandidates.map((candidate) => candidate.connectionId),
  );

  return {
    mcpServers: [
      ...materialized.mcpServers.map((server) => ({
        ...server,
        ...(server.transport === "http" ? { headers: server.headers ?? [] } : {}),
        ...(server.transport === "stdio"
          ? { args: server.args ?? [], env: server.env ?? [] }
          : {}),
      } as SessionMcpServer)),
      ...finalizedStdio.mcpServers,
    ],
    mcpBindingSummaries: [
      ...materialized.mcpBindingSummaries
        .filter((summary) => !finalizedStdioIds.has(summary.id))
        .map((summary) => ({
          ...summary,
          displayName: summary.displayName ?? undefined,
          reason: summary.reason ?? undefined,
        } as SessionMcpBindingSummary)),
      ...finalizedStdio.summaries,
    ],
    warnings: [
      ...materialized.warnings.map((warning) => ({
        connectionId: warning.connectionId,
        catalogEntryId: warning.catalogEntryId as ConnectorLaunchResolutionWarning["catalogEntryId"],
        connectorName: warning.connectorName,
        kind: warning.kind,
      } as ConnectorLaunchResolutionWarning)),
      ...finalizedStdio.warnings,
    ],
  };
}
