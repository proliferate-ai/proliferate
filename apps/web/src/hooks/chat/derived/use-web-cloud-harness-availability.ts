import { useMemo } from "react";
import type {
  AgentAuthCredential,
  AgentGatewayCapabilities,
  CloudAgentCatalogResponse,
  CloudWorkspaceDetail,
} from "@proliferate/cloud-sdk";
import {
  readyCloudAgentKinds,
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
  const readyAgentKinds = useMemo(
    () => readyCloudAgentKinds({
      credentials: agentAuthCredentials,
      agentGateway,
    }),
    [agentAuthCredentials, agentGateway],
  );
  const readyAgentKindsKey = readyAgentKinds.join("\0");
  const agentGatewayManagedCreditKindsKey = agentGateway?.managedCreditAgentKinds?.join("\0") ?? "";
  const agentGatewayAuthSlotsKey = agentGateway?.agentAuthSlots
    .map((slot) => `${slot.agentKind}:${slot.authSlotId}:${slot.credentialProviderIds.join(",")}`)
    .join("\0") ?? "";
  const catalogAgentKindsKey = agentCatalog?.agents.map((agent) => agent.kind).join("\0") ?? "";
  const workspaceHarnessAvailability = useMemo(() => resolveCloudHarnessAvailability({
    catalogAgentKinds: agentCatalog?.agents.map((agent) => agent.kind),
    allowedAgentKinds: workspace?.allowedAgentKinds,
    readyAgentKinds: workspace?.readyAgentKinds
      ?? (workspaceUsesManagedRuntime
        ? readyAgentKinds
        : agentCatalog?.agents.map((agent) => agent.kind)),
    agentGateway: workspaceUsesManagedRuntime ? agentGateway : null,
    assumeFallbackAgentKindsLaunchable: !workspaceUsesManagedRuntime,
  }), [
    agentCatalog,
    readyAgentKindsKey,
    agentGateway?.enabled,
    agentGateway?.managedCreditsOrganizationEnabled,
    agentGateway?.managedCreditsPersonalEnabled,
    agentGateway?.opencodeGatewayEnabled,
    agentGatewayAuthSlotsKey,
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
