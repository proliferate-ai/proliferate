import type { CloudConnectionInfo, CloudWorkspaceDetail } from "@proliferate/cloud-sdk/types";
import { ProliferateClientError } from "@proliferate/cloud-sdk";
import {
  getCloudWorkspace,
} from "@proliferate/cloud-sdk/client/workspaces";
import {
  type CloudSandboxGatewayUrlSource,
  resolveCloudSandboxGatewayConnectionForWorkspace,
} from "#product/lib/access/cloud/cloud-sandbox-gateway";

export const CLOUD_WORKSPACE_CONNECTION_RETRY_DELAY_MS = 750;
export const CLOUD_WORKSPACE_CONNECTION_MAX_RETRIES = 8;

// A 409 `cloud_sandbox_runtime_not_ready` means the server scheduled a cold
// access repair that reprovisions the sandbox VM in the background; retries
// must span that provision (30-60s), far beyond the generic budget above.
export const CLOUD_SANDBOX_RUNTIME_PROVISIONING_RETRY_DELAY_MS = 2_000;
export const CLOUD_SANDBOX_RUNTIME_PROVISIONING_MAX_RETRIES = 45;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

function isRetryableNetworkError(error: unknown): boolean {
  return error instanceof TypeError;
}

export function isCloudSandboxRuntimeProvisioningError(error: unknown): boolean {
  return error instanceof ProliferateClientError
    && error.code === "cloud_sandbox_runtime_not_ready";
}

export function isCloudWorkspaceNotReadyError(error: unknown): boolean {
  return error instanceof ProliferateClientError
    && (
      error.code === "workspace_not_ready"
      || isCloudSandboxRuntimeProvisioningError(error)
    );
}

export function isRetryableCloudWorkspaceConnectionError(error: unknown): boolean {
  if (error instanceof ProliferateClientError) {
    return isCloudWorkspaceNotReadyError(error) || error.status >= 500;
  }

  return isRetryableNetworkError(error);
}

export function cloudWorkspaceConnectionRetryBudget(error: unknown): {
  maxRetries: number;
  delayMs: number;
} {
  if (isCloudSandboxRuntimeProvisioningError(error)) {
    return {
      maxRetries: CLOUD_SANDBOX_RUNTIME_PROVISIONING_MAX_RETRIES,
      delayMs: CLOUD_SANDBOX_RUNTIME_PROVISIONING_RETRY_DELAY_MS,
    };
  }
  return {
    maxRetries: CLOUD_WORKSPACE_CONNECTION_MAX_RETRIES,
    delayMs: CLOUD_WORKSPACE_CONNECTION_RETRY_DELAY_MS,
  };
}

export async function retryCloudWorkspaceRequest<T>(
  request: () => Promise<T>,
  fallbackMessage: string,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await request();
    } catch (error) {
      const { maxRetries, delayMs } = cloudWorkspaceConnectionRetryBudget(error);
      if (
        attempt >= maxRetries
        || !isRetryableCloudWorkspaceConnectionError(error)
      ) {
        throw error instanceof Error ? error : new Error(fallbackMessage);
      }
      await wait(delayMs);
    }
  }
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
