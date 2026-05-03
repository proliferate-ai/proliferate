import type {
  SessionMcpBindingSummary,
  SessionMcpServer,
} from "@anyharness/sdk";
import { finalizeLocalStdioCandidates } from "@/lib/domain/mcp/local-stdio-finalizer";
import type { ConnectorLaunchResolutionWarning } from "@/lib/domain/mcp/types";
import { materializeCloudMcpServers } from "@/lib/integrations/cloud/mcp_materialization";
import {
  releaseGoogleWorkspaceMcpRuntimeEnv,
  resolveGoogleWorkspaceMcpRuntimeEnv,
} from "@/platform/tauri/google-workspace-mcp";
import { commandExists } from "@/platform/tauri/process";

export interface ConnectorLaunchContext {
  targetLocation: "local" | "cloud";
  workspacePath: string | null;
  launchId: string;
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
  releaseRuntimeReservations: () => Promise<void>;
}> {
  if (!launchContext.policy.enabled) {
    return {
      mcpServers: [],
      mcpBindingSummaries: [],
      warnings: [],
      releaseRuntimeReservations: async () => {},
    };
  }

  const materialized = await materializeCloudMcpServers({
    targetLocation: launchContext.targetLocation,
  });
  const finalizedStdio = await finalizeLocalStdioCandidates(
    materialized.localStdioCandidates,
    { workspacePath: launchContext.workspacePath, launchId: launchContext.launchId },
    { commandExists, resolveGoogleWorkspaceMcpRuntimeEnv },
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
        catalogEntryId: warning.catalogEntryId ?? undefined,
        customDefinitionId: warning.customDefinitionId ?? undefined,
        connectorName: warning.connectorName,
        kind: warning.kind,
      } as ConnectorLaunchResolutionWarning)),
      ...finalizedStdio.warnings,
    ],
    releaseRuntimeReservations: async () => {
      await Promise.all(finalizedStdio.runtimeReservations.map((reservation) =>
        releaseGoogleWorkspaceMcpRuntimeEnv({
          connectionId: reservation.connectionId,
          launchId: reservation.launchId,
        }).catch(() => undefined)
      ));
    },
  };
}
