import { getProliferateClient, type ProliferateCloudClient } from "./core.js";
import type {
  ExportWorkspaceMoveResponse,
  FailWorkspaceMoveRequest,
  InstallWorkspaceMoveRequest,
  StartWorkspaceMoveRequest,
  WorkspaceMoveResponse,
} from "../types/index.js";

export type {
  ExportWorkspaceMoveResponse,
  FailWorkspaceMoveRequest,
  InstallWorkspaceMoveRequest,
  StartWorkspaceMoveRequest,
  WorkspaceMoveEndpointRef,
  WorkspaceMoveCanonicalSide,
  WorkspaceMovePhase,
  WorkspaceMoveResponse,
  WorkspaceMoveRuntimeKind,
} from "../types/index.js";

/**
 * `ProliferateClientError.code` thrown by `startWorkspaceMove` when the
 * destination branch already has an independent, active cloud workspace that
 * is not this identity's own prior move destination (spec section 2,
 * "Collision"). The caller should offer open-vs-replace rather than retry.
 */
export const WORKSPACE_MOVE_CLOUD_WORKSPACE_EXISTS_ERROR_CODE = "cloud_workspace_exists";

export async function startWorkspaceMove(
  body: StartWorkspaceMoveRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<WorkspaceMoveResponse> {
  return client.requestJson<WorkspaceMoveResponse>({
    method: "POST",
    path: "/v1/cloud/workspace-moves",
    body,
  });
}

export async function getWorkspaceMove(
  moveId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<WorkspaceMoveResponse> {
  return client.requestJson<WorkspaceMoveResponse>({
    method: "GET",
    path: `/v1/cloud/workspace-moves/${encodeURIComponent(moveId)}`,
  });
}

export async function installWorkspaceMove(
  moveId: string,
  body: InstallWorkspaceMoveRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<WorkspaceMoveResponse> {
  return client.requestJson<WorkspaceMoveResponse>({
    method: "POST",
    path: `/v1/cloud/workspace-moves/${encodeURIComponent(moveId)}/install`,
    body,
  });
}

export async function exportWorkspaceMove(
  moveId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<ExportWorkspaceMoveResponse> {
  return client.requestJson<ExportWorkspaceMoveResponse>({
    method: "POST",
    path: `/v1/cloud/workspace-moves/${encodeURIComponent(moveId)}/export`,
  });
}

export async function cutoverWorkspaceMove(
  moveId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<WorkspaceMoveResponse> {
  return client.requestJson<WorkspaceMoveResponse>({
    method: "POST",
    path: `/v1/cloud/workspace-moves/${encodeURIComponent(moveId)}/cutover`,
  });
}

export async function completeWorkspaceMove(
  moveId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<WorkspaceMoveResponse> {
  return client.requestJson<WorkspaceMoveResponse>({
    method: "POST",
    path: `/v1/cloud/workspace-moves/${encodeURIComponent(moveId)}/complete`,
  });
}

export async function failWorkspaceMove(
  moveId: string,
  body: FailWorkspaceMoveRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<WorkspaceMoveResponse> {
  return client.requestJson<WorkspaceMoveResponse>({
    method: "POST",
    path: `/v1/cloud/workspace-moves/${encodeURIComponent(moveId)}/fail`,
    body,
  });
}
