import { useCallback } from "react";
import type { CloudWorkspaceDetail } from "@/lib/access/cloud/client";
import { getCloudWorkspace } from "@proliferate/cloud-sdk/client/workspaces";
import {
  isCloudWorkspacePending,
  resolveCloudWorkspaceStatus,
} from "@/lib/domain/workspaces/cloud/cloud-workspace-status";

const CLOUD_WORKSPACE_READY_POLL_MS = 3_000;
const CLOUD_WORKSPACE_READY_TIMEOUT_MS = 120_000;

export function describeCloudWorkspaceNotReadyFailure(
  workspace: CloudWorkspaceDetail,
): string | null {
  const status = resolveCloudWorkspaceStatus(workspace);
  if (status === "ready") {
    return null;
  }
  if (status === "error") {
    return workspace.lastError
      ?? workspace.statusDetail
      ?? "Cloud workspace provisioning failed.";
  }
  if (!isCloudWorkspacePending(status)) {
    return workspace.statusDetail
      ?? `Cloud workspace stopped before it became ready (${status ?? "unknown"}).`;
  }
  return null;
}

export function useCloudWorkspaceReadinessWaiter() {
  return useCallback(async (cloudWorkspaceId: string): Promise<CloudWorkspaceDetail> => {
    const deadline = Date.now() + CLOUD_WORKSPACE_READY_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const workspace = await getCloudWorkspace(cloudWorkspaceId);
      if (!workspace) {
        throw new Error("Cloud workspace not found.");
      }
      if (resolveCloudWorkspaceStatus(workspace) === "ready") {
        return workspace;
      }
      const failureMessage = describeCloudWorkspaceNotReadyFailure(workspace);
      if (failureMessage) {
        throw new Error(failureMessage);
      }

      await new Promise((resolve) => {
        window.setTimeout(resolve, CLOUD_WORKSPACE_READY_POLL_MS);
      });
    }

    throw new Error("Timed out waiting for the cloud workspace to become ready.");
  }, []);
}
