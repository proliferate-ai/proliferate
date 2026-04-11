import { useCallback } from "react";
import type { CloudWorkspaceDetail } from "@/lib/integrations/cloud/client";
import { getCloudWorkspace } from "@/lib/integrations/cloud/workspaces";

const CLOUD_WORKSPACE_READY_POLL_MS = 3_000;
const CLOUD_WORKSPACE_READY_TIMEOUT_MS = 120_000;

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

      await new Promise((resolve) => {
        window.setTimeout(resolve, CLOUD_WORKSPACE_READY_POLL_MS);
      });
    }

    throw new Error("Timed out waiting for the cloud workspace to become ready.");
  }, []);
}
