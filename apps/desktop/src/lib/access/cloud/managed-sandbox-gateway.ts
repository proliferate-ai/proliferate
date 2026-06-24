import {
  ensureManagedSandboxRepoRuntimeConnection,
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
  anyharnessRepoRootId: string | null;
};

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
    anyharnessRepoRootId: runtime.anyharnessRepoRootId,
  };
}

export function resolveManagedSandboxGatewayConnectionForWorkspace(
  workspace: CloudWorkspaceDetail,
): Promise<ManagedSandboxGatewayConnectionInfo> {
  return resolveManagedSandboxGatewayConnectionForRepo({
    gitOwner: workspace.repo.owner,
    gitRepoName: workspace.repo.name,
    allowedAgentKinds: workspace.allowedAgentKinds,
    readyAgentKinds: workspace.readyAgentKinds,
    runtimeAuth: workspace.runtime?.runtimeAuth ?? null,
  });
}
