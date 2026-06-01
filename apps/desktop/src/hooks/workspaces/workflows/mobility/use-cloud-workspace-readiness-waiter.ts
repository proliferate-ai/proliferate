import { useCallback } from "react";
import type { CloudWorkspaceDetail } from "@/lib/access/cloud/client";
import { getCloudWorkspace } from "@proliferate/cloud-sdk/client/workspaces";
import { isCloudWorkspacePending } from "@/lib/domain/workspaces/cloud/cloud-workspace-status";

const CLOUD_WORKSPACE_READY_POLL_MS = 3_000;
const CLOUD_WORKSPACE_READY_TIMEOUT_MS = 120_000;

export function describeCloudWorkspaceNotReadyFailure(
  workspace: CloudWorkspaceDetail,
): string | null {
  if (workspace.status === "ready") {
    return null;
  }
  if (workspace.status === "error") {
    return workspace.lastError
      ?? workspace.statusDetail
      ?? "Cloud workspace provisioning failed.";
  }
  if (!isCloudWorkspacePending(workspace.status)) {
    return workspace.statusDetail
      ?? `Cloud workspace stopped before it became ready (${workspace.status}).`;
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
      if (workspace.status === "ready") {
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
