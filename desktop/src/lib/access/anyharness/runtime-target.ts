import type { CloudAgentKind, CloudWorkspaceDetail } from "@/lib/access/cloud/client";
import {
  getCloudWorkspace,
  getCloudWorkspaceConnection,
} from "@/lib/access/cloud/workspaces";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";

export interface RuntimeTarget {
  location: "local" | "cloud";
  baseUrl: string;
  authToken?: string;
  anyharnessWorkspaceId: string;
  runtimeGeneration: number;
  allowedAgentKinds?: CloudAgentKind[];
  readyAgentKinds?: CloudAgentKind[];
}

export async function resolveRuntimeTargetForWorkspace(
  runtimeUrl: string,
  workspaceId: string,
): Promise<RuntimeTarget> {
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
    allowedAgentKinds: connection.allowedAgentKinds,
    readyAgentKinds: connection.readyAgentKinds as CloudAgentKind[],
  };
}
