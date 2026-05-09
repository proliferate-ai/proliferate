import type {
  SessionMcpBindingSummary,
  SessionMcpServer,
} from "@anyharness/sdk";
import {
  buildLocalStdioAppliedSummary,
  buildLocalStdioNotAppliedSummary,
  buildLocalStdioRuntimeReservation,
  buildLocalStdioServer,
  buildLocalStdioWarning,
  getLocalStdioGoogleWorkspaceOAuthMetadata,
  localStdioCandidateNeedsWorkspacePath,
  resolveLocalStdioCandidateLaunchValues,
  type LocalStdioCandidate,
  type LocalStdioFinalizationContext,
  type LocalStdioRuntimeReservation,
} from "@/lib/domain/mcp/local-stdio-finalizer";
import type { ConnectorLaunchResolutionWarning } from "@/lib/domain/mcp/types";

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
  runtimeReservations: LocalStdioRuntimeReservation[];
}> {
  const mcpServers: SessionMcpServer[] = [];
  const summaries: SessionMcpBindingSummary[] = [];
  const warnings: ConnectorLaunchResolutionWarning[] = [];
  const runtimeReservations: LocalStdioRuntimeReservation[] = [];
  const commandAvailabilityCache = new Map<string, boolean>();

  async function commandAvailable(command: string): Promise<boolean> {
    const cached = commandAvailabilityCache.get(command);
    if (cached !== undefined) {
      return cached;
    }
    const available = await dependencies.commandExists(command).catch(() => false);
    commandAvailabilityCache.set(command, available);
    return available;
  }

  for (const candidate of candidates) {
    const localOauth = getLocalStdioGoogleWorkspaceOAuthMetadata(candidate);
    if (localStdioCandidateNeedsWorkspacePath(candidate) && !context.workspacePath) {
      summaries.push(buildLocalStdioNotAppliedSummary(candidate, "workspace_path_unresolved"));
      warnings.push(buildLocalStdioWarning(candidate, "workspace_path_unresolved"));
      continue;
    }
    if (!await commandAvailable(candidate.command)) {
      summaries.push(buildLocalStdioNotAppliedSummary(candidate, "resolver_error"));
      warnings.push(buildLocalStdioWarning(candidate, "command_missing"));
      continue;
    }
    const resolved = resolveLocalStdioCandidateLaunchValues(candidate, context);
    if (!resolved) {
      summaries.push(buildLocalStdioNotAppliedSummary(candidate, "resolver_error"));
      warnings.push(buildLocalStdioWarning(candidate, "resolver_error"));
      continue;
    }
    if (candidate.setupKind === "local_oauth") {
      if (!localOauth || localOauth.provider !== "google_workspace") {
        summaries.push(buildLocalStdioNotAppliedSummary(candidate, "resolver_error"));
        warnings.push(buildLocalStdioWarning(candidate, "resolver_error"));
        continue;
      }
      const runtimeEnv = await dependencies.resolveGoogleWorkspaceMcpRuntimeEnv({
        connectionId: candidate.connectionId,
        userGoogleEmail: localOauth.userGoogleEmail,
        launchId: context.launchId,
      }).catch(() => ({ status: "not_ready" as const, code: "port_unavailable" }));
      if (runtimeEnv.status === "not_ready") {
        const reason = runtimeEnv.code === "port_unavailable"
          ? "resolver_error"
          : "needs_reconnect";
        summaries.push(buildLocalStdioNotAppliedSummary(candidate, reason));
        warnings.push(buildLocalStdioWarning(candidate, reason));
        continue;
      }
      resolved.env.push(...runtimeEnv.env);
      runtimeReservations.push(buildLocalStdioRuntimeReservation(candidate, context));
    }
    mcpServers.push(buildLocalStdioServer(candidate, resolved));
    summaries.push(buildLocalStdioAppliedSummary(candidate));
  }

  return { mcpServers, summaries, warnings, runtimeReservations };
}
