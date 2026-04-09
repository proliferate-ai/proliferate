import { getProliferateClient } from "./client";
import type {
  CloudConnectionInfo,
  CloudWorkspaceDetail,
  CloudWorkspaceSummary,
  CreateCloudWorkspaceRequest,
} from "./client";

export async function listCloudWorkspaces(): Promise<CloudWorkspaceSummary[]> {
  return (await getProliferateClient().GET("/v1/cloud/workspaces")).data!;
}

export async function getCloudWorkspace(
  workspaceId: string,
): Promise<CloudWorkspaceDetail | undefined> {
  return (
    await getProliferateClient().GET("/v1/cloud/workspaces/{workspace_id}", {
      params: { path: { workspace_id: workspaceId } },
    })
  ).data;
}

export async function createCloudWorkspace(
  input: CreateCloudWorkspaceRequest,
): Promise<CloudWorkspaceDetail> {
  return (await getProliferateClient().POST("/v1/cloud/workspaces", { body: input })).data!;
}

export async function startCloudWorkspace(workspaceId: string): Promise<CloudWorkspaceDetail> {
  return (
    await getProliferateClient().POST("/v1/cloud/workspaces/{workspace_id}/start", {
      params: { path: { workspace_id: workspaceId } },
    })
  ).data!;
}

export async function stopCloudWorkspace(workspaceId: string): Promise<CloudWorkspaceDetail> {
  return (
    await getProliferateClient().POST("/v1/cloud/workspaces/{workspace_id}/stop", {
      params: { path: { workspace_id: workspaceId } },
    })
  ).data!;
}

export async function resyncCloudWorkspaceCredentials(
  workspaceId: string,
): Promise<CloudWorkspaceDetail> {
  return (
    await getProliferateClient().POST("/v1/cloud/workspaces/{workspace_id}/sync-credentials", {
      params: { path: { workspace_id: workspaceId } },
    })
  ).data!;
}

export async function updateCloudWorkspaceBranch(
  workspaceId: string,
  branchName: string,
): Promise<CloudWorkspaceDetail> {
  return (
    await getProliferateClient().PATCH("/v1/cloud/workspaces/{workspace_id}/branch", {
      params: { path: { workspace_id: workspaceId } },
      body: { branchName },
    })
  ).data!;
}

export async function updateCloudWorkspaceDisplayName(
  workspaceId: string,
  displayName: string | null,
): Promise<CloudWorkspaceDetail> {
  return (
    await getProliferateClient().PATCH("/v1/cloud/workspaces/{workspace_id}/display-name", {
      params: { path: { workspace_id: workspaceId } },
      body: { displayName },
    })
  ).data!;
}

export async function deleteCloudWorkspace(workspaceId: string): Promise<void> {
  await getProliferateClient().DELETE("/v1/cloud/workspaces/{workspace_id}", {
    params: { path: { workspace_id: workspaceId } },
  });
}

export async function getCloudWorkspaceConnection(
  workspaceId: string,
): Promise<CloudConnectionInfo> {
  return (
    await getProliferateClient().GET("/v1/cloud/workspaces/{workspace_id}/connection", {
      params: { path: { workspace_id: workspaceId } },
    })
  ).data!;
}
