import type { ProliferateCloudClient } from "@proliferate/cloud-sdk";
import type {
  CloudConnectionInfo,
  CloudWorkspaceDetail,
} from "@/lib/access/cloud/client";
import {
  getDesktopCloudAccessToken,
  isCloudAgentKind,
  ProliferateClientError,
} from "@/lib/access/cloud/client";

export type AnyHarnessRuntimeAccessKind = "direct" | "proliferate-gateway";

export type CloudSandboxGatewayConnectionInfo = CloudConnectionInfo & {
  runtimeAccessKind: "proliferate-gateway";
  webSocketAuthTransport: "protocol";
  anyharnessRepoRootId: string | null;
};

export function isCloudSandboxGatewayConnectionInfo(
  connection: CloudConnectionInfo | null | undefined,
): connection is CloudSandboxGatewayConnectionInfo {
  return (connection as { runtimeAccessKind?: string } | null | undefined)?.runtimeAccessKind
    === "proliferate-gateway";
}

export async function withFreshCloudSandboxGatewayAccessToken<
  Connection extends CloudConnectionInfo,
>(connection: Connection): Promise<Connection> {
  if (!isCloudSandboxGatewayConnectionInfo(connection)) {
    return connection;
  }
  return {
    ...connection,
    accessToken: await getDesktopCloudAccessToken(),
  };
}

export function resolveCloudSandboxGatewayConnectionForWorkspace(
  workspace: CloudWorkspaceDetail,
  cloudClient: ProliferateCloudClient,
): Promise<CloudSandboxGatewayConnectionInfo> {
  return resolveCloudSandboxGatewayConnectionForCloudWorkspace({
    anyharnessWorkspaceId: workspace.anyharnessWorkspaceId ?? null,
    allowedAgentKinds: workspace.allowedAgentKinds,
    readyAgentKinds: workspace.readyAgentKinds,
    runtimeGeneration: workspace.runtime?.generation ?? 0,
  }, cloudClient);
}

export async function resolveCloudSandboxGatewayConnectionForCloudWorkspace(input: {
  anyharnessWorkspaceId: string | null;
  allowedAgentKinds?: string[];
  readyAgentKinds?: string[];
  runtimeGeneration?: number;
}, cloudClient: ProliferateCloudClient): Promise<
  CloudSandboxGatewayConnectionInfo
> {
  if (!input.anyharnessWorkspaceId) {
    throw new ProliferateClientError(
      "Cloud workspace is missing its AnyHarness workspace id.",
      409,
      "workspace_not_ready",
    );
  }
  const productToken = await getDesktopCloudAccessToken();
  return {
    runtimeUrl: cloudClient.buildUrl("/v1/gateway/cloud-sandbox/anyharness"),
    accessToken: productToken,
    anyharnessWorkspaceId: input.anyharnessWorkspaceId,
    runtimeGeneration: input.runtimeGeneration ?? 0,
    allowedAgentKinds: (input.allowedAgentKinds ?? []).filter(isCloudAgentKind),
    readyAgentKinds: input.readyAgentKinds ?? [],
    runtimeAccessKind: "proliferate-gateway",
    webSocketAuthTransport: "protocol",
    anyharnessRepoRootId: null,
  };
}
