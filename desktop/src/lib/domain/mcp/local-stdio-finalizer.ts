import type {
  SessionMcpBindingSummary,
  SessionMcpServer,
} from "@anyharness/sdk";
import type { ConnectorLaunchResolutionWarning } from "@/lib/domain/mcp/types";

type LocalStdioTemplateSource =
  | { kind: "static"; value: string }
  | { kind: "workspace_path" };

interface LocalStdioArgTemplate {
  source: LocalStdioTemplateSource;
}

interface LocalStdioEnvTemplate {
  name: string;
  source: Extract<LocalStdioTemplateSource, { kind: "static" }>;
}

export interface LocalStdioCandidate {
  connectionId: string;
  catalogEntryId: string;
  serverName: string;
  connectorName: string;
  setupKind: "none" | "local_oauth";
  localOauth?: {
    provider: "google_workspace";
    userGoogleEmail: string;
    requiredScope: string;
  } | null;
  command: string;
  args: LocalStdioArgTemplate[];
  env: LocalStdioEnvTemplate[];
}

export interface LocalStdioFinalizationContext {
  workspacePath: string | null;
  launchId: string;
}

export interface LocalStdioRuntimeReservation {
  provider: "google_workspace";
  connectionId: string;
  launchId: string;
}

export interface LocalStdioResolvedLaunchValues {
  args: string[];
  env: { name: string; value: string }[];
}

export function getLocalStdioGoogleWorkspaceOAuthMetadata(
  candidate: LocalStdioCandidate,
): {
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

export function localStdioCandidateNeedsWorkspacePath(
  candidate: LocalStdioCandidate,
): boolean {
  return candidate.args.some((arg) => arg.source.kind === "workspace_path");
}

export function resolveLocalStdioCandidateLaunchValues(
  candidate: LocalStdioCandidate,
  context: LocalStdioFinalizationContext,
): LocalStdioResolvedLaunchValues | null {
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

export function buildLocalStdioWarning(
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

export function buildLocalStdioNotAppliedSummary(
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

export function buildLocalStdioAppliedSummary(
  candidate: LocalStdioCandidate,
): SessionMcpBindingSummary {
  return {
    id: candidate.connectionId,
    serverName: candidate.serverName,
    displayName: candidate.connectorName,
    transport: "stdio",
    outcome: "applied",
  };
}

export function buildLocalStdioServer(
  candidate: LocalStdioCandidate,
  resolved: LocalStdioResolvedLaunchValues,
): SessionMcpServer {
  return {
    transport: "stdio",
    connectionId: candidate.connectionId,
    catalogEntryId: candidate.catalogEntryId,
    serverName: candidate.serverName,
    command: candidate.command,
    args: resolved.args,
    env: resolved.env,
  };
}

export function buildLocalStdioRuntimeReservation(
  candidate: LocalStdioCandidate,
  context: LocalStdioFinalizationContext,
): LocalStdioRuntimeReservation {
  return {
    provider: "google_workspace",
    connectionId: candidate.connectionId,
    launchId: context.launchId,
  };
}
