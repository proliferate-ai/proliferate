import type {
  CloudConnectionInfo,
  CloudRuntimeAuthState,
  CloudWorkspaceDetail,
} from "@/lib/access/cloud/client";
import {
  getDesktopCloudAccessToken,
  getProliferateClient,
  isCloudAgentKind,
  ProliferateClientError,
} from "@/lib/access/cloud/client";

const CURRENT_RUNTIME_AUTH: CloudRuntimeAuthState = {
  status: "current",
  configCurrent: true,
  targetCurrent: true,
  requiresRestart: false,
};

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
): Promise<CloudSandboxGatewayConnectionInfo> {
  return resolveCloudSandboxGatewayConnectionForCloudWorkspace({
    anyharnessWorkspaceId: workspace.anyharnessWorkspaceId ?? null,
    allowedAgentKinds: workspace.allowedAgentKinds,
    readyAgentKinds: workspace.readyAgentKinds,
    runtimeAuth: workspace.runtime?.runtimeAuth ?? null,
    runtimeGeneration: workspace.runtime?.generation ?? 0,
  });
}

export async function resolveCloudSandboxGatewayConnectionForCloudWorkspace(input: {
  anyharnessWorkspaceId: string | null;
  allowedAgentKinds?: string[];
  readyAgentKinds?: string[];
  runtimeAuth?: CloudRuntimeAuthState | null;
  runtimeGeneration?: number;
}): Promise<CloudSandboxGatewayConnectionInfo> {
  if (!input.anyharnessWorkspaceId) {
    throw new ProliferateClientError(
      "Cloud workspace is missing its AnyHarness workspace id.",
      409,
      "workspace_not_ready",
    );
  }
  const productToken = await getDesktopCloudAccessToken();
  return {
    runtimeUrl: getProliferateClient().buildUrl("/v1/gateway/cloud-sandbox/anyharness"),
    accessToken: productToken,
    anyharnessWorkspaceId: input.anyharnessWorkspaceId,
    runtimeGeneration: input.runtimeGeneration ?? 0,
    allowedAgentKinds: (input.allowedAgentKinds ?? []).filter(isCloudAgentKind),
    readyAgentKinds: input.readyAgentKinds ?? [],
    runtimeAuth: input.runtimeAuth ?? CURRENT_RUNTIME_AUTH,
    runtimeAccessKind: "proliferate-gateway",
    webSocketAuthTransport: "protocol",
    anyharnessRepoRootId: null,
  };
}
