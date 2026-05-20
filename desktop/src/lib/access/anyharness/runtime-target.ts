import type { AgentAuthAgentKind, CloudWorkspaceDetail } from "@/lib/access/cloud/client";
import {
  getCloudWorkspace,
  getCloudWorkspaceConnection,
} from "@proliferate/cloud-sdk/client/workspaces";
import { ensureSshAnyHarnessTunnel } from "@/lib/access/tauri/ssh-tunnel";
import { getSshDirectTargetProfile } from "@/lib/access/tauri/ssh-target-profile";
import { parseTargetWorkspaceSyntheticId } from "@/lib/domain/compute/target-workspace-id";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";

export interface RuntimeTarget {
  location: "local" | "cloud" | "target";
  baseUrl: string;
  authToken?: string;
  anyharnessWorkspaceId: string;
  runtimeGeneration: number;
  allowedAgentKinds?: AgentAuthAgentKind[];
  readyAgentKinds?: AgentAuthAgentKind[];
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

  const cloudWorkspace: CloudWorkspaceDetail | undefined = await getCloudWorkspace(cloudWorkspaceId);
  if (!cloudWorkspace) throw new Error("Cloud workspace not found.");
  if (cloudWorkspace.status !== "ready") {
    throw new Error("Cloud workspace is not ready yet.");
  }

  const connection = await getCloudWorkspaceConnection(cloudWorkspace.id);

  return {
    location: "cloud",
    baseUrl: connection.runtimeUrl,
    authToken: connection.accessToken,
    anyharnessWorkspaceId: connection.anyharnessWorkspaceId ?? "",
    runtimeGeneration: connection.runtimeGeneration,
    allowedAgentKinds: connection.allowedAgentKinds.filter(isCloudAgentRuntimeKind),
    readyAgentKinds: connection.readyAgentKinds.filter(isCloudAgentRuntimeKind),
  };
}

function isCloudAgentRuntimeKind(value: string): value is AgentAuthAgentKind {
  return value === "claude"
    || value === "codex"
    || value === "opencode"
    || value === "gemini";
}
