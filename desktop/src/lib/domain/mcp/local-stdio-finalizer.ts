import type {
  SessionMcpBindingSummary,
  SessionMcpServer,
} from "@anyharness/sdk";
import type { LocalStdioCandidate } from "@/lib/integrations/cloud/client";
import type { ConnectorLaunchResolutionWarning } from "@/lib/domain/mcp/types";
import { commandExists } from "@/platform/tauri/process";

export interface LocalStdioFinalizationContext {
  workspacePath: string | null;
}

export async function finalizeLocalStdioCandidates(
  candidates: LocalStdioCandidate[],
  context: LocalStdioFinalizationContext,
): Promise<{
  mcpServers: SessionMcpServer[];
  summaries: SessionMcpBindingSummary[];
  warnings: ConnectorLaunchResolutionWarning[];
}> {
  const mcpServers: SessionMcpServer[] = [];
  const summaries: SessionMcpBindingSummary[] = [];
  const warnings: ConnectorLaunchResolutionWarning[] = [];
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

  for (const candidate of candidates) {
    const needsWorkspacePath = candidate.args.some(
      (arg) => arg.source.kind === "workspace_path",
    );
    if (needsWorkspacePath && !context.workspacePath) {
      summaries.push(buildNotAppliedSummary(candidate, "workspace_path_unresolved"));
      warnings.push(buildWarning(candidate, "workspace_path_unresolved"));
      continue;
    }
    if (!await commandAvailable(candidate.command)) {
      summaries.push(buildNotAppliedSummary(candidate, "resolver_error"));
      warnings.push(buildWarning(candidate, "command_missing"));
      continue;
    }
    mcpServers.push({
      transport: "stdio",
      connectionId: candidate.connectionId,
      catalogEntryId: candidate.catalogEntryId,
      serverName: candidate.serverName,
      command: candidate.command,
      args: candidate.args.map((arg) => (
        arg.source.kind === "workspace_path"
          ? context.workspacePath ?? ""
          : arg.source.value ?? ""
      )),
      env: candidate.env.map((env) => ({
        name: env.name,
        value: env.source.kind === "static" ? env.source.value ?? "" : "",
      })),
    });
    summaries.push({
      id: candidate.connectionId,
      serverName: candidate.serverName,
      displayName: candidate.connectorName,
      transport: "stdio",
      outcome: "applied",
    });
  }

  return { mcpServers, summaries, warnings };
}

function buildWarning(
  candidate: LocalStdioCandidate,
  kind: ConnectorLaunchResolutionWarning["kind"],
): ConnectorLaunchResolutionWarning {
  return {
    kind,
    connectionId: candidate.connectionId,
    catalogEntryId: candidate.catalogEntryId as ConnectorLaunchResolutionWarning["catalogEntryId"],
    connectorName: candidate.connectorName,
  };
}

function buildNotAppliedSummary(
  candidate: LocalStdioCandidate,
  reason: SessionMcpBindingSummary["reason"],
): SessionMcpBindingSummary {
  return {
    id: candidate.connectionId,
    serverName: candidate.serverName,
    displayName: candidate.connectorName,
    transport: "stdio",
    outcome: "not_applied",
    reason,
  };
}
