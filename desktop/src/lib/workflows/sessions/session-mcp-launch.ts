import type {
  SessionMcpBindingSummary,
  SessionMcpServer,
  SessionPluginBundle,
} from "@anyharness/sdk";
import type {
  AnyHarnessClientConnection,
  AnyHarnessResolvedConnection,
} from "@anyharness/sdk-react";
import type { ConnectorLaunchResolutionWarning } from "@/lib/domain/mcp/types";
import { refreshRuntimeConfigForLaunch } from "@/lib/workflows/mcp/runtime-config-refresh";

type RuntimeConfigConnection = AnyHarnessClientConnection | AnyHarnessResolvedConnection;

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
  connection?: RuntimeConfigConnection;
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
  pluginBundle?: SessionPluginBundle;
  releaseRuntimeReservations: () => Promise<void>;
}> {
  if (!launchContext.policy.enabled) {
    return {
      mcpServers: [],
      mcpBindingSummaries: [],
      warnings: [],
      pluginBundle: undefined,
      releaseRuntimeReservations: async () => {},
    };
  }
  if (!launchContext.connection) {
    return {
      mcpServers: [],
      mcpBindingSummaries: [],
      warnings: [],
      pluginBundle: undefined,
      releaseRuntimeReservations: async () => {},
    };
  }

  const refreshed = await refreshRuntimeConfigForLaunch({
    connection: launchContext.connection,
    targetLocation: launchContext.targetLocation,
    workspacePath: launchContext.workspacePath,
  });

  return {
    mcpServers: [],
    mcpBindingSummaries: [],
    warnings: refreshed.warnings,
    pluginBundle: undefined,
    releaseRuntimeReservations: async () => {},
  };
}
