import {
  ensureCloudSandboxRepoRuntimeConnection,
  ensureCloudSandboxWorkspaceRuntimeConnection,
} from "@proliferate/cloud-sdk/client/cloud-sandboxes";
import type {
  CloudConnectionInfo,
  CloudRuntimeAuthState,
  CloudWorkspaceDetail,
} from "@/lib/access/cloud/client";
import { getDesktopCloudAccessToken, isCloudAgentKind } from "@/lib/access/cloud/client";

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

export async function resolveCloudSandboxGatewayConnectionForRepo(input: {
  gitOwner: string;
  gitRepoName: string;
  allowedAgentKinds?: string[];
  readyAgentKinds?: string[];
  runtimeAuth?: CloudRuntimeAuthState | null;
}): Promise<CloudSandboxGatewayConnectionInfo> {
  const productToken = await getDesktopCloudAccessToken();
  const runtime = await ensureCloudSandboxRepoRuntimeConnection(
    input.gitOwner,
    input.gitRepoName,
  );
  return {
    runtimeUrl: runtime.gatewayAnyHarnessBaseUrl,
    accessToken: productToken,
    anyharnessWorkspaceId: runtime.anyharnessWorkspaceId,
    runtimeGeneration: runtime.runtimeGeneration,
    allowedAgentKinds: (input.allowedAgentKinds ?? []).filter(isCloudAgentKind),
    readyAgentKinds: input.readyAgentKinds ?? [],
    runtimeAuth: input.runtimeAuth ?? CURRENT_RUNTIME_AUTH,
    runtimeAccessKind: "proliferate-gateway",
    webSocketAuthTransport: "protocol",
    anyharnessRepoRootId: runtime.anyharnessRepoRootId,
  };
}

export function resolveCloudSandboxGatewayConnectionForWorkspace(
  workspace: CloudWorkspaceDetail,
): Promise<CloudSandboxGatewayConnectionInfo> {
  return resolveCloudSandboxGatewayConnectionForCloudWorkspace({
    workspaceId: workspace.id,
    allowedAgentKinds: workspace.allowedAgentKinds,
    readyAgentKinds: workspace.readyAgentKinds,
    runtimeAuth: workspace.runtime?.runtimeAuth ?? null,
  });
}

export async function resolveCloudSandboxGatewayConnectionForCloudWorkspace(input: {
  workspaceId: string;
  allowedAgentKinds?: string[];
  readyAgentKinds?: string[];
  runtimeAuth?: CloudRuntimeAuthState | null;
}): Promise<CloudSandboxGatewayConnectionInfo> {
  const productToken = await getDesktopCloudAccessToken();
  const runtime = await ensureCloudSandboxWorkspaceRuntimeConnection(input.workspaceId);
  return {
    runtimeUrl: runtime.gatewayAnyHarnessBaseUrl,
    accessToken: productToken,
    anyharnessWorkspaceId: runtime.anyharnessWorkspaceId,
    runtimeGeneration: runtime.runtimeGeneration,
    allowedAgentKinds: (input.allowedAgentKinds ?? []).filter(isCloudAgentKind),
    readyAgentKinds: input.readyAgentKinds ?? [],
    runtimeAuth: input.runtimeAuth ?? CURRENT_RUNTIME_AUTH,
    runtimeAccessKind: "proliferate-gateway",
    webSocketAuthTransport: "protocol",
    anyharnessRepoRootId: runtime.anyharnessRepoRootId,
  };
}
