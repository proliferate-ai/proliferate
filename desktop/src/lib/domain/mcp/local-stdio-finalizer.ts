import type {
  SessionMcpBindingSummary,
  SessionMcpServer,
} from "@anyharness/sdk";
import type { LocalStdioCandidate } from "@/lib/integrations/cloud/client";
import type { ConnectorLaunchResolutionWarning } from "@/lib/domain/mcp/types";

export interface LocalStdioFinalizationContext {
  workspacePath: string | null;
  launchId: string;
}

export interface LocalStdioFinalizerDependencies {
  commandExists: (command: string) => Promise<boolean>;
  resolveGoogleWorkspaceMcpRuntimeEnv: (input: {
    connectionId: string;
    userGoogleEmail: string;
    launchId: string;
  }) => Promise<{
    status: "ready";
    env: { name: string; value: string }[];
  } | {
    status: "not_ready";
    code: string;
  }>;
}

export async function finalizeLocalStdioCandidates(
  candidates: LocalStdioCandidate[],
  context: LocalStdioFinalizationContext,
  dependencies: LocalStdioFinalizerDependencies,
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
    const available = await dependencies.commandExists(command);
    commandAvailabilityCache.set(command, available);
    return available;
  }

  for (const candidate of candidates) {
    const localOauth = getLocalOauthMetadata(candidate);
    let localOauthEnv: { name: string; value: string }[] = [];
    if (candidate.setupKind === "local_oauth") {
      if (!localOauth || localOauth.provider !== "google_workspace") {
        summaries.push(buildNotAppliedSummary(candidate, "resolver_error"));
        warnings.push(buildWarning(candidate, "resolver_error"));
        continue;
      }
      const runtimeEnv = await dependencies.resolveGoogleWorkspaceMcpRuntimeEnv({
        connectionId: candidate.connectionId,
        userGoogleEmail: localOauth.userGoogleEmail,
        launchId: context.launchId,
      });
      if (runtimeEnv.status === "not_ready") {
        summaries.push(buildNotAppliedSummary(candidate, "needs_reconnect"));
        warnings.push(buildWarning(candidate, "needs_reconnect"));
        continue;
      }
      localOauthEnv = runtimeEnv.env;
    }
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
    const resolved = resolveCandidateLaunchValues(candidate, context);
    if (!resolved) {
      summaries.push(buildNotAppliedSummary(candidate, "resolver_error"));
      warnings.push(buildWarning(candidate, "resolver_error"));
      continue;
    }
    resolved.env.push(...localOauthEnv);
    mcpServers.push({
      transport: "stdio",
      connectionId: candidate.connectionId,
      catalogEntryId: candidate.catalogEntryId,
      serverName: candidate.serverName,
      command: candidate.command,
      args: resolved.args,
      env: resolved.env,
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

function getLocalOauthMetadata(candidate: LocalStdioCandidate): {
  provider: "google_workspace";
  userGoogleEmail: string;
  requiredScope: string;
} | null {
  const localOauth = candidate.localOauth;
  if (!localOauth || localOauth.provider !== "google_workspace") {
    return null;
  }
  return {
    provider: "google_workspace",
    userGoogleEmail: localOauth.userGoogleEmail,
    requiredScope: localOauth.requiredScope,
  };
}

function resolveCandidateLaunchValues(
  candidate: LocalStdioCandidate,
  context: LocalStdioFinalizationContext,
): { args: string[]; env: { name: string; value: string }[] } | null {
  const args: string[] = [];
  for (const arg of candidate.args) {
    if (arg.source.kind === "workspace_path") {
      args.push(context.workspacePath ?? "");
      continue;
    }
    if (arg.source.kind === "static") {
      args.push(arg.source.value ?? "");
      continue;
    }
    return null;
  }

  const env: { name: string; value: string }[] = [];
  for (const item of candidate.env) {
    if (item.source.kind !== "static") {
      return null;
    }
    env.push({ name: item.name, value: item.source.value ?? "" });
  }
  return { args, env };
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
