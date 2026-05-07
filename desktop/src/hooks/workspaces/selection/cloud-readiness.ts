import type { CloudWorkspaceDetail } from "@/lib/access/cloud/client";
import { getCloudWorkspace } from "@/lib/access/cloud/workspaces";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud-ids";
import {
  elapsedMs,
  logLatency,
  startLatencyTimer,
} from "@/lib/infra/measurement/debug-latency";
import { resetWorkspaceEditorState } from "@/stores/editor/workspace-editor-state";
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
    resetWorkspaceEditorState();
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
