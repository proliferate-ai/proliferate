import type {
  CloudConnectionInfo,
  CloudWorkspaceDetail,
} from "@/lib/access/cloud/client";
import {
  ProliferateClientError,
} from "@/lib/access/cloud/client";
import {
  getCloudWorkspace,
} from "@proliferate/cloud-sdk/client/workspaces";
import {
  type CloudSandboxGatewayUrlSource,
  resolveCloudSandboxGatewayConnectionForWorkspace,
} from "@/lib/access/cloud/cloud-sandbox-gateway";

export const CLOUD_WORKSPACE_CONNECTION_RETRY_DELAY_MS = 750;
export const CLOUD_WORKSPACE_CONNECTION_MAX_RETRIES = 8;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

function isRetryableNetworkError(error: unknown): boolean {
  return error instanceof TypeError;
}

export function isCloudWorkspaceNotReadyError(error: unknown): boolean {
  return error instanceof ProliferateClientError
    && error.code === "workspace_not_ready";
}

export function isRetryableCloudWorkspaceConnectionError(error: unknown): boolean {
  if (error instanceof ProliferateClientError) {
    return isCloudWorkspaceNotReadyError(error) || error.status >= 500;
  }

  return isRetryableNetworkError(error);
}

export async function retryCloudWorkspaceRequest<T>(
  request: () => Promise<T>,
  fallbackMessage: string,
): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= CLOUD_WORKSPACE_CONNECTION_MAX_RETRIES; attempt += 1) {
    try {
      return await request();
    } catch (error) {
      lastError = error;
      if (
        attempt >= CLOUD_WORKSPACE_CONNECTION_MAX_RETRIES
        || !isRetryableCloudWorkspaceConnectionError(error)
      ) {
        throw error;
      }
      await wait(CLOUD_WORKSPACE_CONNECTION_RETRY_DELAY_MS);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(fallbackMessage);
}

export function getCloudWorkspaceWithRetry(
  workspaceId: string,
): Promise<CloudWorkspaceDetail | undefined> {
  return retryCloudWorkspaceRequest(
    () => getCloudWorkspace(workspaceId),
    "Failed to load cloud workspace.",
  );
}

export async function getResolvedCloudWorkspaceConnection(
  workspaceId: string,
  cloudClient: CloudSandboxGatewayUrlSource | null,
): Promise<CloudConnectionInfo> {
  const workspace = await getCloudWorkspace(workspaceId);
  if (!workspace) {
    throw new ProliferateClientError(
      "Cloud workspace not found.",
      404,
      "workspace_not_found",
    );
  }
  return resolveCloudSandboxGatewayConnectionForWorkspace(workspace, cloudClient);
}

export function getCloudWorkspaceConnectionWithRetry(
  workspaceId: string,
  cloudClient: CloudSandboxGatewayUrlSource | null,
): Promise<CloudConnectionInfo> {
  return retryCloudWorkspaceRequest(
    () => getResolvedCloudWorkspaceConnection(workspaceId, cloudClient),
    "Failed to connect to cloud workspace.",
  );
}
