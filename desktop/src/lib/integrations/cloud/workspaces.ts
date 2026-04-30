import { getProliferateClient } from "./client";
import type {
  CloudConnectionInfo,
  CloudWorkspaceDetail,
  CloudWorkspaceStatus,
  CloudWorkspaceSummary,
  CreateCloudWorkspaceRequest,
} from "./client";

type CloudWorkspaceTransport = Record<string, unknown> & {
  actionBlockKind?: string | null;
  actionBlockReason?: string | null;
  runtime?: {
    actionBlockKind?: string | null;
    actionBlockReason?: string | null;
  } | null;
  status?: string;
  workspaceStatus?: string;
};

function normalizeCloudWorkspaceStatus(value: string | undefined): CloudWorkspaceStatus {
  switch (value) {
    case "pending":
    case "queued":
      return "pending";
    case "materializing":
    case "provisioning":
    case "syncing_credentials":
    case "cloning_repo":
    case "starting_runtime":
      return "materializing";
    case "ready":
      return "ready";
    case "archived":
    case "stopped":
      return "archived";
    case "error":
    default:
      return "error";
  }
}

function normalizeCloudWorkspace<T extends CloudWorkspaceTransport>(
  workspace: T,
): T & { status: CloudWorkspaceStatus; workspaceStatus: CloudWorkspaceStatus } {
  const status = normalizeCloudWorkspaceStatus(workspace.workspaceStatus ?? workspace.status);
  return {
    ...workspace,
    actionBlockKind: workspace.runtime?.actionBlockKind ?? workspace.actionBlockKind ?? null,
    actionBlockReason: workspace.runtime?.actionBlockReason ?? workspace.actionBlockReason ?? null,
    status,
    workspaceStatus: status,
  };
}

export async function listCloudWorkspaces(): Promise<CloudWorkspaceSummary[]> {
  const data = (await getProliferateClient().GET("/v1/cloud/workspaces")).data!;
  return data.map((workspace) => normalizeCloudWorkspace(workspace) as CloudWorkspaceSummary);
}

export async function getCloudWorkspace(
  workspaceId: string,
): Promise<CloudWorkspaceDetail | undefined> {
  const data = (
    await getProliferateClient().GET("/v1/cloud/workspaces/{workspace_id}", {
      params: { path: { workspace_id: workspaceId } },
    })
  ).data;
  return data ? normalizeCloudWorkspace(data) as CloudWorkspaceDetail : undefined;
}

export async function createCloudWorkspace(
  input: CreateCloudWorkspaceRequest,
): Promise<CloudWorkspaceDetail> {
  const data = (await getProliferateClient().POST("/v1/cloud/workspaces", { body: input })).data!;
  return normalizeCloudWorkspace(data) as CloudWorkspaceDetail;
}

export async function startCloudWorkspace(workspaceId: string): Promise<CloudWorkspaceDetail> {
  const data = (
    await getProliferateClient().POST("/v1/cloud/workspaces/{workspace_id}/start", {
      params: { path: { workspace_id: workspaceId } },
    })
  ).data!;
  return normalizeCloudWorkspace(data) as CloudWorkspaceDetail;
}

export async function resyncCloudWorkspaceCredentials(
  workspaceId: string,
): Promise<CloudWorkspaceDetail> {
  const data = (
    await getProliferateClient().POST("/v1/cloud/workspaces/{workspace_id}/sync-credentials", {
      params: { path: { workspace_id: workspaceId } },
    })
  ).data!;
  return normalizeCloudWorkspace(data) as CloudWorkspaceDetail;
}

export async function updateCloudWorkspaceBranch(
  workspaceId: string,
  branchName: string,
): Promise<CloudWorkspaceDetail> {
  const data = (
    await getProliferateClient().PATCH("/v1/cloud/workspaces/{workspace_id}/branch", {
      params: { path: { workspace_id: workspaceId } },
      body: { branchName },
    })
  ).data!;
  return normalizeCloudWorkspace(data) as CloudWorkspaceDetail;
}

export async function updateCloudWorkspaceDisplayName(
  workspaceId: string,
  displayName: string | null,
): Promise<CloudWorkspaceDetail> {
  const data = (
    await getProliferateClient().PATCH("/v1/cloud/workspaces/{workspace_id}/display-name", {
      params: { path: { workspace_id: workspaceId } },
      body: { displayName },
    })
  ).data!;
  return normalizeCloudWorkspace(data) as CloudWorkspaceDetail;
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
  ).data! as CloudConnectionInfo;
}
