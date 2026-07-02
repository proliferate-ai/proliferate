import type { CloudAgentKind, CloudWorkspaceDetail } from "@/lib/access/cloud/client";
import type { TerminalWebSocketAuthTransport } from "@anyharness/sdk";
import { resolveCloudSandboxGatewayConnectionForWorkspace } from "@/lib/access/cloud/cloud-sandbox-gateway";
import { getCloudWorkspaceWithRetry } from "@/lib/access/cloud/workspace-connection-retry";
import { ensureSshAnyHarnessTunnel } from "@/lib/access/tauri/ssh-tunnel";
import { getSshDirectTargetProfile } from "@/lib/access/tauri/ssh-target-profile";
import { resolveSshDirectTargetBearer } from "@/lib/access/anyharness/ssh-direct-bearer";
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
): Promise<RuntimeTarget> {
  const targetWorkspace = parseTargetWorkspaceSyntheticId(workspaceId);
  if (targetWorkspace) {
    const profile = await getSshDirectTargetProfile(targetWorkspace.targetId);
    if (!profile) {
      throw new Error(
        "SSH direct access is not configured for this target. Add the SSH host, user, and key in Compute settings.",
      );
    }
    const authToken = await resolveSshDirectTargetBearer(profile);
    const tunnel = await ensureSshAnyHarnessTunnel({
      targetId: profile.targetId,
      sshHost: profile.sshHost,
      sshUser: profile.sshUser,
      sshPort: profile.sshPort,
      identityFile: profile.identityFile ?? null,
      remoteAnyHarnessPort: profile.remoteAnyHarnessPort,
      anyharnessBearerToken: authToken,
    });
    return {
      location: "target",
      baseUrl: tunnel.localUrl,
      authToken: authToken ?? undefined,
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
    || value === "gemini"
    || value === "grok";
}
