import type { AgentAuthAgentKind, CloudWorkspaceDetail } from "@/lib/access/cloud/client";
import type { TerminalWebSocketAuthTransport } from "@anyharness/sdk";
import { resolveManagedSandboxGatewayConnectionForWorkspace } from "@/lib/access/cloud/managed-sandbox-gateway";
import {
  getCloudWorkspaceConnectionWithRetry,
  getCloudWorkspaceWithRetry,
} from "@/lib/access/cloud/workspace-connection-retry";
import { ensureSshAnyHarnessTunnel } from "@/lib/access/tauri/ssh-tunnel";
import { getSshDirectTargetProfile } from "@/lib/access/tauri/ssh-target-profile";
import { parseTargetWorkspaceSyntheticId } from "@/lib/domain/compute/target-workspace-id";
import { cloudWorkspaceUsesManagedSandboxGateway } from "@/lib/domain/workspaces/cloud/cloud-runtime-kind";
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
  allowedAgentKinds?: AgentAuthAgentKind[];
  readyAgentKinds?: AgentAuthAgentKind[];
}

export function runtimeTargetUsesCloudCommand(
  target: Pick<RuntimeTarget, "location" | "runtimeAccessKind">,
): boolean {
  return target.location === "cloud" && target.runtimeAccessKind !== "proliferate-gateway";
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
    const tunnel = await ensureSshAnyHarnessTunnel({
      targetId: profile.targetId,
      sshHost: profile.sshHost,
      sshUser: profile.sshUser,
      sshPort: profile.sshPort,
      identityFile: profile.identityFile ?? null,
      remoteAnyHarnessPort: profile.remoteAnyHarnessPort,
    });
    return {
      location: "target",
      baseUrl: tunnel.localUrl,
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

  const localTargetWorkspaceId = localDesktopCloudWorkspaceRuntimeId(cloudWorkspace);
  if (localTargetWorkspaceId) {
    return {
      location: "local",
      baseUrl: runtimeUrl,
      anyharnessWorkspaceId: localTargetWorkspaceId,
      runtimeGeneration: cloudWorkspace.runtime?.generation ?? 0,
      cloudWorkspaceId: cloudWorkspace.id,
      targetId: localDesktopCloudWorkspaceTargetId(cloudWorkspace) ?? undefined,
      allowedAgentKinds: cloudWorkspace.allowedAgentKinds.filter(isCloudAgentRuntimeKind),
      readyAgentKinds: cloudWorkspace.readyAgentKinds.filter(isCloudAgentRuntimeKind),
    };
  }

  if (cloudWorkspaceUsesManagedSandboxGateway(cloudWorkspace)) {
    const connection = await resolveManagedSandboxGatewayConnectionForWorkspace(cloudWorkspace);
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

  const connection = await getCloudWorkspaceConnectionWithRetry(cloudWorkspace.id);

  return {
    location: "cloud",
    baseUrl: connection.runtimeUrl,
    authToken: connection.accessToken,
    anyharnessWorkspaceId: connection.anyharnessWorkspaceId ?? "",
    runtimeGeneration: connection.runtimeGeneration,
    runtimeAccessKind: "direct",
    cloudWorkspaceId: cloudWorkspace.id,
    targetId: cloudWorkspaceCommandMetadata.targetId ?? undefined,
    allowedAgentKinds: connection.allowedAgentKinds.filter(isCloudAgentRuntimeKind),
    readyAgentKinds: connection.readyAgentKinds.filter(isCloudAgentRuntimeKind),
  };
}

function localDesktopCloudWorkspaceRuntimeId(
  workspace: CloudWorkspaceDetail,
): string | null {
  const executionKind = workspace.executionTarget?.kind ?? null;
  const directTargetKind = workspace.directTargetContext?.targetKind ?? null;
  const localDesktopTarget = executionKind === "local_desktop"
    || workspace.sandboxType === "local"
    || directTargetKind === "desktop_dispatch"
    || directTargetKind === "local_direct";
  if (!localDesktopTarget) {
    return null;
  }
  return workspace.anyharnessWorkspaceId
    ?? workspace.primaryMaterialization?.anyharnessWorkspaceId
    ?? workspace.directTargetContext?.anyharnessWorkspaceId
    ?? null;
}

function localDesktopCloudWorkspaceTargetId(
  workspace: CloudWorkspaceCommandMetadata,
): string | null {
  return workspace.executionTarget?.targetId
    ?? workspace.directTargetContext?.targetId
    ?? workspace.targetId
    ?? null;
}

function isCloudAgentRuntimeKind(value: string): value is AgentAuthAgentKind {
  return value === "claude"
    || value === "codex"
    || value === "opencode"
    || value === "gemini"
    || value === "grok";
}
