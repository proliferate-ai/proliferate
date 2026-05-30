import type {
  CloudConnectionInfo,
  CloudWorkspaceDetail,
} from "@/lib/access/cloud/client";
import {
  ProliferateClientError,
} from "@/lib/access/cloud/client";
import {
  getCloudWorkspace,
  getCloudWorkspaceConnection,
} from "@proliferate/cloud-sdk/client/workspaces";

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

export function getCloudWorkspaceConnectionWithRetry(
  workspaceId: string,
): Promise<CloudConnectionInfo> {
  return retryCloudWorkspaceRequest(
    () => getCloudWorkspaceConnection(workspaceId),
    "Failed to connect to cloud workspace.",
  );
}
