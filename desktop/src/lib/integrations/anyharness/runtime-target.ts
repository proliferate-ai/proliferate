import { cloudWorkspaceConnectionKey } from "@/hooks/cloud/query-keys";
import { cloudWorkspaceConnectionQueryOptions } from "@/hooks/cloud/use-cloud-workspace-connection";
import type { CloudAgentKind, CloudConnectionInfo, CloudWorkspaceDetail } from "@/lib/integrations/cloud/client";
import { getCloudWorkspace } from "@/lib/integrations/cloud/workspaces";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud-ids";
import { appQueryClient } from "@/lib/infra/query-client";

async function fetchCloudConnection(workspaceId: string): Promise<CloudConnectionInfo> {
  return appQueryClient.fetchQuery(
    cloudWorkspaceConnectionQueryOptions(workspaceId),
  );
}

export interface RuntimeTarget {
  location: "local" | "cloud";
  baseUrl: string;
  authToken?: string;
  anyharnessWorkspaceId: string;
  runtimeGeneration: number;
  allowedAgentKinds?: CloudAgentKind[];
  readyAgentKinds?: CloudAgentKind[];
}

export async function clearCachedCloudConnections(workspaceId?: string): Promise<void> {
  if (workspaceId) {
    const filters = {
      queryKey: cloudWorkspaceConnectionKey(workspaceId),
      exact: true as const,
    };
    await appQueryClient.cancelQueries(filters);
    appQueryClient.removeQueries(filters);
    return;
  }

  const filters = {
    predicate: (query: { queryKey: readonly unknown[] }) => {
      const key = query.queryKey;
      return key[0] === "cloud"
        && key[1] === "workspaces"
        && key[3] === "connection";
    },
  };
  await appQueryClient.cancelQueries(filters);
  appQueryClient.removeQueries(filters);
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

  const connection = await fetchCloudConnection(cloudWorkspace.id);

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
