import type { CloudAgentKind, CloudWorkspaceDetail } from "@/lib/access/cloud/client";
import type { DesktopSshBridge } from "@proliferate/product-client/host/desktop-bridge";
import type { TerminalWebSocketAuthTransport } from "@anyharness/sdk";
import { resolveCloudSandboxGatewayConnectionForWorkspace } from "@/lib/access/cloud/cloud-sandbox-gateway";
import { getCloudWorkspaceWithRetry } from "@/lib/access/cloud/workspace-connection-retry";
import { parseTargetWorkspaceSyntheticId } from "@/lib/domain/compute/target-workspace-id";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";
import { resolveCloudWorkspaceStatus } from "@/lib/domain/workspaces/cloud/cloud-workspace-status";

type CloudWorkspaceCommandMetadata = CloudWorkspaceDetail & {
  targetId?: string | null;
};

export interface RuntimeTarget {
  location: "local" | "cloud" | "target";
  baseUrl: string;
  authToken?: string;
  webSocketAuthTransport?: TerminalWebSocketAuthTransport;
  anyharnessWorkspaceId: string;
  runtimeGeneration: number;
  runtimeAccessKind?: "direct" | "proliferate-gateway";
  cloudWorkspaceId?: string;
  targetId?: string;
  allowedAgentKinds?: CloudAgentKind[];
  readyAgentKinds?: CloudAgentKind[];
}

export async function resolveRuntimeTargetForWorkspace(
  runtimeUrl: string,
  workspaceId: string,
  ssh: DesktopSshBridge | null = null,
): Promise<RuntimeTarget> {
  const targetWorkspace = parseTargetWorkspaceSyntheticId(workspaceId);
  if (targetWorkspace) {
    if (!ssh) {
      throw new Error("SSH direct access is only available in Desktop.");
    }
    const profile = await ssh.getProfile(targetWorkspace.targetId);
    if (!profile) {
      throw new Error(
        "SSH direct access is not configured for this target. Add the SSH host, user, and key in Compute settings.",
      );
    }
    const tunnel = await ssh.ensureTunnel(profile);
    return {
      location: "target",
      baseUrl: tunnel.runtimeUrl,
      anyharnessWorkspaceId: targetWorkspace.anyharnessWorkspaceId,
      runtimeGeneration: 0,
      targetId: targetWorkspace.targetId,
    };
  }

  const cloudWorkspaceId = parseCloudWorkspaceSyntheticId(workspaceId);
  if (!cloudWorkspaceId) {
    return {
      location: "local",
      baseUrl: runtimeUrl,
      anyharnessWorkspaceId: workspaceId,
      runtimeGeneration: 0,
    };
  }

  const cloudWorkspace: CloudWorkspaceDetail | undefined =
    await getCloudWorkspaceWithRetry(cloudWorkspaceId);
  if (!cloudWorkspace) throw new Error("Cloud workspace not found.");
  const cloudWorkspaceCommandMetadata = cloudWorkspace as CloudWorkspaceCommandMetadata;
  if (resolveCloudWorkspaceStatus(cloudWorkspace) !== "ready") {
    throw new Error("Cloud workspace is not ready yet.");
  }

  if (cloudWorkspace.visibility === "shared_unclaimed") {
    throw new Error("Claim this workspace before opening it directly in Desktop.");
  }

  const connection = await resolveCloudSandboxGatewayConnectionForWorkspace(cloudWorkspace);
  return {
    location: "cloud",
    baseUrl: connection.runtimeUrl,
    authToken: connection.accessToken,
    webSocketAuthTransport: connection.webSocketAuthTransport,
    anyharnessWorkspaceId: connection.anyharnessWorkspaceId ?? "",
    runtimeGeneration: connection.runtimeGeneration,
    runtimeAccessKind: "proliferate-gateway",
    cloudWorkspaceId: cloudWorkspace.id,
    targetId: cloudWorkspaceCommandMetadata.targetId ?? undefined,
    allowedAgentKinds: connection.allowedAgentKinds.filter(isCloudAgentRuntimeKind),
    readyAgentKinds: connection.readyAgentKinds.filter(isCloudAgentRuntimeKind),
  };
}

function isCloudAgentRuntimeKind(value: string): value is CloudAgentKind {
  return value === "claude"
    || value === "codex"
    || value === "opencode"
    || value === "grok";
}
