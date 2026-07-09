import { useMemo } from "react";
import type {
  CloudAgentCatalogResponse,
  CloudWorkspaceDetail,
} from "@proliferate/cloud-sdk";
import {
  resolveCloudHarnessAvailability,
} from "@proliferate/product-domain/chats/cloud/harness-availability";

export function useWebCloudHarnessAvailability(input: {
  workspace: CloudWorkspaceDetail | null;
  agentCatalog: CloudAgentCatalogResponse | undefined;
}) {
  const { workspace, agentCatalog } = input;
  const workspaceReadyAgentKindsKey = workspace?.readyAgentKinds?.join("\0") ?? "";
  const workspaceAllowedAgentKindsKey = workspace?.allowedAgentKinds?.join("\0") ?? "";
  const catalogAgentKindsKey = agentCatalog?.agents.map((agent) => agent.kind).join("\0") ?? "";
  const workspaceHarnessAvailability = useMemo(() => resolveCloudHarnessAvailability({
    catalogAgentKinds: agentCatalog?.agents.map((agent) => agent.kind),
    allowedAgentKinds: workspace?.allowedAgentKinds,
  }), [
    agentCatalog,
    catalogAgentKindsKey,
    workspaceAllowedAgentKindsKey,
  ]);
  const workspaceLaunchableAgentKinds = workspaceHarnessAvailability.launchableAgentKinds;

  return {
    workspaceAllowedAgentKindsKey,
    workspaceReadyAgentKindsKey,
    workspaceHarnessAvailability,
    workspaceLaunchableAgentKinds,
    canStartNewSession: workspaceLaunchableAgentKinds.length > 0,
  };
}
