import type { CloudWorkspaceDetail } from "@/lib/access/cloud/client";
import type { ProliferateCloudClient } from "@proliferate/cloud-sdk";
import { getCloudWorkspace } from "@proliferate/cloud-sdk/client/workspaces";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";
import { resolveCloudWorkspaceStatus } from "@/lib/domain/workspaces/cloud/cloud-workspace-status";
import {
  elapsedMs,
  logLatency,
  startLatencyTimer,
} from "@/lib/infra/measurement/debug-latency";
import { resetWorkspaceEditorState } from "@/stores/editor/workspace-editor-state";
import { markWorkspaceViewed } from "@/stores/preferences/workspace-ui-store";
import { isWorkspaceSelectionCurrent } from "./guards";
import type { CloudReadinessResult, WorkspaceSelectionContext } from "./types";
import { requireHostCloudClient } from "@/lib/access/cloud/host-client";

export async function resolveCloudWorkspaceReadiness(
  context: WorkspaceSelectionContext,
  cloudClient: ProliferateCloudClient | null,
): Promise<CloudReadinessResult> {
  const cloudWorkspaceId = parseCloudWorkspaceSyntheticId(context.workspaceId);
  if (!cloudWorkspaceId) {
    return { kind: "local" };
  }

  const cloudLookupStartedAt = startLatencyTimer();
  const cloudWorkspace: CloudWorkspaceDetail | undefined = await getCloudWorkspace(
    cloudWorkspaceId,
    requireHostCloudClient(cloudClient),
  );
  if (!cloudWorkspace) {
    return { kind: "cloud-missing", cloudWorkspaceId };
  }
  const workspaceStatus = resolveCloudWorkspaceStatus(cloudWorkspace);

  logLatency("workspace.select.cloud_lookup", {
    workspaceId: context.workspaceId,
    cloudWorkspaceId,
    status: workspaceStatus,
    elapsedMs: elapsedMs(cloudLookupStartedAt),
  });

  if (!isWorkspaceSelectionCurrent(context.workspaceId, context.selectionNonce)) {
    return { kind: "stale", cloudWorkspaceId };
  }

  if (workspaceStatus !== "ready") {
    resetWorkspaceEditorState();
    markWorkspaceViewed(context.workspaceId);
    logLatency("workspace.select.cloud_not_ready", {
      workspaceId: context.workspaceId,
      cloudWorkspaceId,
      status: workspaceStatus,
      totalElapsedMs: elapsedMs(context.selectionStartedAt),
    });
    return {
      kind: "cloud-pending",
      cloudWorkspaceId,
      status: workspaceStatus ?? "pending",
    };
  }

  const localRuntimeWorkspaceId = localDesktopCloudWorkspaceRuntimeId(cloudWorkspace);
  if (localRuntimeWorkspaceId) {
    return { kind: "local", runtimeWorkspaceId: localRuntimeWorkspaceId };
  }

  return { kind: "cloud-ready", cloudWorkspaceId };
}

function localDesktopCloudWorkspaceRuntimeId(
  workspace: CloudWorkspaceDetail,
): string | null {
  const executionKind = workspace.executionTarget?.kind ?? null;
  const directTargetKind = workspace.directTargetContext?.targetKind ?? null;
  const localDesktopTarget = executionKind === "local_desktop"
    || workspace.sandboxType === "local"
    || directTargetKind === "desktop_dispatch"
    || directTargetKind === "local_direct";
  if (!localDesktopTarget) {
    return null;
  }
  return workspace.anyharnessWorkspaceId
    ?? workspace.primaryMaterialization?.anyharnessWorkspaceId
    ?? workspace.directTargetContext?.anyharnessWorkspaceId
    ?? null;
}
