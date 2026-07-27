import { AnyHarnessError } from "@anyharness/sdk";
import type { CloudConnectionInfo, CloudWorkspaceDetail } from "@proliferate/cloud-sdk/types";
import { ProliferateClientError } from "@proliferate/cloud-sdk";
import {
  getCloudWorkspace,
} from "@proliferate/cloud-sdk/client/workspaces";
import {
  type CloudSandboxGatewayUrlSource,
  resolveCloudSandboxGatewayConnectionForWorkspace,
} from "#product/lib/access/cloud/cloud-sandbox-gateway";
import {
  isCloudStartBlockReason,
  type CloudStartBlockReason,
} from "#product/lib/domain/workspaces/cloud/cloud-workspace-status";

export const CLOUD_WORKSPACE_CONNECTION_RETRY_DELAY_MS = 750;
export const CLOUD_WORKSPACE_CONNECTION_MAX_RETRIES = 8;

const BILLING_BLOCK_CODES = new Set([
  "billing_credits_exhausted",
  "billing_start_blocked",
]);

export interface CloudWorkspaceBillingBlock {
  code: "billing_credits_exhausted" | "billing_start_blocked";
  startBlockReason: CloudStartBlockReason | null;
}

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

export function getCloudWorkspaceBillingBlockFromError(
  error: unknown,
): CloudWorkspaceBillingBlock | null {
  let status: number | null = null;
  let code: unknown;
  let reason: unknown;

  if (error instanceof AnyHarnessError) {
    status = error.problem.status;
    code = error.details?.code;
    reason = error.details?.reason;
  } else if (error instanceof ProliferateClientError) {
    status = error.status;
    code = error.code;
    reason = error.details.reason;
  }

  if (
    status !== 402
    || typeof code !== "string"
    || !BILLING_BLOCK_CODES.has(code)
  ) {
    return null;
  }

  const startBlockReason = typeof reason === "string" ? reason : null;
  return {
    code: code as CloudWorkspaceBillingBlock["code"],
    startBlockReason: isCloudStartBlockReason(startBlockReason)
      ? startBlockReason
      : null,
  };
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
