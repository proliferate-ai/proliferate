import type { CloudWorkspaceDetail } from "@/lib/integrations/cloud/client";
import { getCloudWorkspace } from "@/lib/integrations/cloud/workspaces";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud-ids";
import {
  elapsedMs,
  logLatency,
  startLatencyTimer,
} from "@/lib/infra/debug-latency";
import { useWorkspaceFilesStore } from "@/stores/editor/workspace-files-store";
import { markWorkspaceViewed } from "@/stores/preferences/workspace-ui-store";
import { isWorkspaceSelectionCurrent } from "./guards";
import type { CloudReadinessResult, WorkspaceSelectionContext } from "./types";

export async function resolveCloudWorkspaceReadiness(
  context: WorkspaceSelectionContext,
): Promise<CloudReadinessResult> {
  const cloudWorkspaceId = parseCloudWorkspaceSyntheticId(context.workspaceId);
  if (!cloudWorkspaceId) {
    return { kind: "local" };
  }

  const cloudLookupStartedAt = startLatencyTimer();
  const cloudWorkspace: CloudWorkspaceDetail | undefined = await getCloudWorkspace(cloudWorkspaceId);
  if (!cloudWorkspace) {
    return { kind: "cloud-missing", cloudWorkspaceId };
  }

  logLatency("workspace.select.cloud_lookup", {
    workspaceId: context.workspaceId,
    cloudWorkspaceId,
    status: cloudWorkspace.status,
    elapsedMs: elapsedMs(cloudLookupStartedAt),
  });

  if (!isWorkspaceSelectionCurrent(context.workspaceId, context.selectionNonce)) {
    return { kind: "stale", cloudWorkspaceId };
  }

  if (cloudWorkspace.status !== "ready") {
    useWorkspaceFilesStore.getState().reset();
    markWorkspaceViewed(context.workspaceId);
    logLatency("workspace.select.cloud_not_ready", {
      workspaceId: context.workspaceId,
      cloudWorkspaceId,
      status: cloudWorkspace.status,
      totalElapsedMs: elapsedMs(context.selectionStartedAt),
    });
    return {
      kind: "cloud-pending",
      cloudWorkspaceId,
      status: cloudWorkspace.status,
    };
  }

  return { kind: "cloud-ready", cloudWorkspaceId };
}
