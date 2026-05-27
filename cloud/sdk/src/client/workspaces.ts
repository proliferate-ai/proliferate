import { getProliferateClient, type ProliferateCloudClient } from "./core.js";
import {
  measureCloudRequest,
  type CloudMeasurementOptions,
} from "./timing.js";
import type {
  CloudConnectionInfo,
  CloudWorkspaceDetail,
  CloudWorkspaceStatus,
  CloudWorkspaceSummary,
  CreateCloudWorkspaceRequest,
} from "../types/index.js";
import type { CloudOwnerSelection } from "./billing.js";

export type CloudWorkspaceListScope =
  | "my"
  | "unclaimed"
  | "claimable"
  | "org-all"
  | "exposed";
export type CloudWorkspaceLifecycleFilter = "active" | "archived" | "all";
export type CloudWorkspaceListSelection = CloudOwnerSelection & {
  scope?: CloudWorkspaceListScope;
  lifecycle?: CloudWorkspaceLifecycleFilter;
};

export interface BootstrapCloudWorkspaceRemoteAccessRequest {
  targetId: string;
  anyharnessWorkspaceId: string;
  anyharnessSessionId?: string | null;
  displayName?: string | null;
  repo?: {
    provider: string;
    owner: string;
    name: string;
    branch: string;
    baseBranch?: string | null;
  } | null;
}

export interface LaunchCloudWorkspaceOnTargetRequest {
  targetId: string;
  gitProvider: "github";
  gitOwner: string;
  gitRepoName: string;
  baseBranch?: string | null;
  branchName: string;
  displayName?: string | null;
  prompt: string;
  promptId?: string | null;
  agentKind: string;
  modelId?: string | null;
  modeId?: string | null;
  sessionConfigUpdates?: Array<{
    configId: string;
    value: string;
  }>;
  source?: "mobile" | "web" | "api";
}

export interface WorkspaceTargetLaunchCommandIds {
  ensureRepoCheckout: string;
  materializeRoot: string;
  materializeWorktree: string;
  startSession: string;
  sendPrompt: string;
  updateSessionConfig: string[];
}

export interface WorkspaceTargetLaunchResponse {
  workspace: CloudWorkspaceDetail;
  sessionId: string;
  sendCommandId: string;
  commandIds: WorkspaceTargetLaunchCommandIds;
}

type CloudWorkspaceTransport = Record<string, unknown> & {
  actionBlockKind?: string | null;
  actionBlockReason?: string | null;
  productLifecycle?: string;
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
    case "needs_rematerialization":
      return "needs_rematerialization";
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
): T & {
  status: CloudWorkspaceStatus;
  workspaceStatus: CloudWorkspaceStatus;
  productLifecycle: string;
} {
  const status = normalizeCloudWorkspaceStatus(workspace.workspaceStatus ?? workspace.status);
  return {
    ...workspace,
    actionBlockKind: workspace.runtime?.actionBlockKind ?? workspace.actionBlockKind ?? null,
    actionBlockReason: workspace.runtime?.actionBlockReason ?? workspace.actionBlockReason ?? null,
    status,
    workspaceStatus: status,
    productLifecycle: workspace.productLifecycle ?? (status === "archived" ? "archived" : "active"),
  };
}

export async function listCloudWorkspaces(
  options?: CloudMeasurementOptions,
  owner?: CloudWorkspaceListSelection,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudWorkspaceSummary[]> {
  const data = await measureCloudRequest({
    operationId: options?.measurementOperationId,
    category: "cloud.workspace.list",
    method: "GET",
    run: async () =>
      client.requestJson<CloudWorkspaceTransport[]>({
        method: "GET",
        path: "/v1/cloud/workspaces",
        query: {
          ownerScope: owner?.ownerScope ?? "personal",
          organizationId: owner?.organizationId ?? undefined,
          scope: owner?.scope,
          lifecycle: owner?.lifecycle,
        },
        signal: options?.signal,
      }),
  });
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
  owner?: CloudOwnerSelection,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudWorkspaceDetail> {
  const data = (
    await client.POST("/v1/cloud/workspaces", {
      body: {
        ...input,
        ownerScope: owner?.ownerScope ?? input.ownerScope ?? "personal",
        organizationId: owner?.organizationId ?? input.organizationId ?? null,
      },
    })
  ).data!;
  return normalizeCloudWorkspace(data) as CloudWorkspaceDetail;
}

export async function bootstrapCloudWorkspaceRemoteAccess(
  input: BootstrapCloudWorkspaceRemoteAccessRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudWorkspaceDetail> {
  const data = await client.requestJson<CloudWorkspaceTransport>({
    method: "POST",
    path: "/v1/cloud/workspaces/remote-access",
    body: input,
  });
  return normalizeCloudWorkspace(data) as CloudWorkspaceDetail;
}

export async function launchCloudWorkspaceOnTarget(
  input: LaunchCloudWorkspaceOnTargetRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<WorkspaceTargetLaunchResponse> {
  const data = await client.requestJson<WorkspaceTargetLaunchResponse>({
    method: "POST",
    path: "/v1/cloud/workspaces/target-launch",
    body: input,
  });
  return {
    ...data,
    workspace: normalizeCloudWorkspace(
      data.workspace as unknown as CloudWorkspaceTransport,
    ) as CloudWorkspaceDetail,
  };
}

export async function startCloudWorkspace(workspaceId: string): Promise<CloudWorkspaceDetail> {
  const data = (
    await getProliferateClient().POST("/v1/cloud/workspaces/{workspace_id}/start", {
      params: { path: { workspace_id: workspaceId } },
    })
  ).data!;
  return normalizeCloudWorkspace(data) as CloudWorkspaceDetail;
}

export async function archiveCloudWorkspace(
  workspaceId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudWorkspaceDetail> {
  const data = await client.requestJson<CloudWorkspaceTransport>({
    method: "POST",
    path: `/v1/cloud/workspaces/${encodeURIComponent(workspaceId)}/archive`,
  });
  return normalizeCloudWorkspace(data) as CloudWorkspaceDetail;
}

export async function restoreCloudWorkspace(
  workspaceId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudWorkspaceDetail> {
  const data = await client.requestJson<CloudWorkspaceTransport>({
    method: "POST",
    path: `/v1/cloud/workspaces/${encodeURIComponent(workspaceId)}/restore`,
  });
  return normalizeCloudWorkspace(data) as CloudWorkspaceDetail;
}

export async function purgeCloudWorkspace(
  workspaceId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<void> {
  await client.requestJson({
    method: "POST",
    path: `/v1/cloud/workspaces/${encodeURIComponent(workspaceId)}/purge`,
  });
}

export async function enableCloudWorkspaceRemoteAccess(
  workspaceId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudWorkspaceDetail> {
  const data = await client.requestJson<CloudWorkspaceTransport>({
    method: "POST",
    path: `/v1/cloud/workspaces/${encodeURIComponent(workspaceId)}/remote-access/enable`,
  });
  return normalizeCloudWorkspace(data) as CloudWorkspaceDetail;
}

export async function disableCloudWorkspaceRemoteAccess(
  workspaceId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudWorkspaceDetail> {
  const data = await client.requestJson<CloudWorkspaceTransport>({
    method: "POST",
    path: `/v1/cloud/workspaces/${encodeURIComponent(workspaceId)}/remote-access/disable`,
  });
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
  options?: CloudMeasurementOptions,
): Promise<CloudWorkspaceDetail> {
  const data = await measureCloudRequest({
    operationId: options?.measurementOperationId,
    category: "cloud.workspace.display_name.update",
    method: "PATCH",
    run: async () => (
      await getProliferateClient().PATCH("/v1/cloud/workspaces/{workspace_id}/display-name", {
        params: { path: { workspace_id: workspaceId } },
        body: { displayName },
      })
    ).data!,
  });
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
