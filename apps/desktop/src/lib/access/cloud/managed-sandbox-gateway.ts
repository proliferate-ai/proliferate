import {
  ensureManagedSandboxRepoRuntimeConnection,
  ensureManagedSandboxWorkspaceRuntimeConnection,
} from "@proliferate/cloud-sdk/client/managed-sandboxes";
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

export type ManagedSandboxGatewayConnectionInfo = CloudConnectionInfo & {
  runtimeAccessKind: "proliferate-gateway";
  webSocketAuthTransport: "protocol";
  anyharnessRepoRootId: string | null;
};

export function isManagedSandboxGatewayConnectionInfo(
  connection: CloudConnectionInfo | null | undefined,
): connection is ManagedSandboxGatewayConnectionInfo {
  return (connection as { runtimeAccessKind?: string } | null | undefined)?.runtimeAccessKind
    === "proliferate-gateway";
}

export async function withFreshManagedSandboxGatewayAccessToken<
  Connection extends CloudConnectionInfo,
>(connection: Connection): Promise<Connection> {
  if (!isManagedSandboxGatewayConnectionInfo(connection)) {
    return connection;
  }
  return {
    ...connection,
    accessToken: await getDesktopCloudAccessToken(),
  };
}

export async function resolveManagedSandboxGatewayConnectionForRepo(input: {
  gitOwner: string;
  gitRepoName: string;
  allowedAgentKinds?: string[];
  readyAgentKinds?: string[];
  runtimeAuth?: CloudRuntimeAuthState | null;
}): Promise<ManagedSandboxGatewayConnectionInfo> {
  const productToken = await getDesktopCloudAccessToken();
  const runtime = await ensureManagedSandboxRepoRuntimeConnection(
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

export function resolveManagedSandboxGatewayConnectionForWorkspace(
  workspace: CloudWorkspaceDetail,
): Promise<ManagedSandboxGatewayConnectionInfo> {
  return resolveManagedSandboxGatewayConnectionForCloudWorkspace({
    workspaceId: workspace.id,
    allowedAgentKinds: workspace.allowedAgentKinds,
    readyAgentKinds: workspace.readyAgentKinds,
    runtimeAuth: workspace.runtime?.runtimeAuth ?? null,
  });
}

export async function resolveManagedSandboxGatewayConnectionForCloudWorkspace(input: {
  workspaceId: string;
  allowedAgentKinds?: string[];
  readyAgentKinds?: string[];
  runtimeAuth?: CloudRuntimeAuthState | null;
}): Promise<ManagedSandboxGatewayConnectionInfo> {
  const productToken = await getDesktopCloudAccessToken();
  const runtime = await ensureManagedSandboxWorkspaceRuntimeConnection(input.workspaceId);
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
