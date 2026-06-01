import { useMemo } from "react";
import type {
  AgentAuthCredential,
  AgentGatewayCapabilities,
  CloudAgentCatalogResponse,
  CloudWorkspaceDetail,
} from "@proliferate/cloud-sdk";
import {
  readySyncedCloudAgentKinds,
  resolveCloudHarnessAvailability,
} from "@proliferate/product-domain/chats/cloud/harness-availability";

export function useWebCloudHarnessAvailability(input: {
  workspace: CloudWorkspaceDetail | null;
  agentCatalog: CloudAgentCatalogResponse | undefined;
  agentGateway: AgentGatewayCapabilities | undefined;
  agentAuthCredentials: readonly AgentAuthCredential[] | undefined;
}) {
  const { workspace, agentCatalog, agentGateway, agentAuthCredentials } = input;
  const workspaceReadyAgentKindsKey = workspace?.readyAgentKinds?.join("\0") ?? "";
  const workspaceAllowedAgentKindsKey = workspace?.allowedAgentKinds?.join("\0") ?? "";
  const workspaceUsesManagedRuntime =
    !workspace || workspace.sandboxType === "managed_personal" || workspace.sandboxType === "managed_shared";
  const readySyncedAgentKinds = useMemo(
    () => readySyncedCloudAgentKinds(agentAuthCredentials),
    [agentAuthCredentials],
  );
  const readySyncedAgentKindsKey = readySyncedAgentKinds.join("\0");
  const agentGatewayManagedCreditKindsKey = agentGateway?.managedCreditAgentKinds?.join("\0") ?? "";
  const catalogAgentKindsKey = agentCatalog?.agents.map((agent) => agent.kind).join("\0") ?? "";
  const workspaceHarnessAvailability = useMemo(() => resolveCloudHarnessAvailability({
    catalogAgentKinds: agentCatalog?.agents.map((agent) => agent.kind),
    allowedAgentKinds: workspace?.allowedAgentKinds,
    readyAgentKinds: workspace?.readyAgentKinds
      ?? (workspaceUsesManagedRuntime
        ? readySyncedAgentKinds
        : agentCatalog?.agents.map((agent) => agent.kind)),
    agentGateway: workspaceUsesManagedRuntime ? agentGateway : null,
    assumeFallbackAgentKindsLaunchable: !workspaceUsesManagedRuntime,
  }), [
    agentCatalog,
    readySyncedAgentKindsKey,
    agentGateway?.enabled,
    agentGateway?.managedCreditsOrganizationEnabled,
    agentGateway?.managedCreditsPersonalEnabled,
    agentGateway?.opencodeGatewayEnabled,
    agentGatewayManagedCreditKindsKey,
    catalogAgentKindsKey,
    workspaceAllowedAgentKindsKey,
    workspaceReadyAgentKindsKey,
    workspaceUsesManagedRuntime,
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
