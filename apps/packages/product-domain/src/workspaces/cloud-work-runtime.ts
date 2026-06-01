import type { CloudWorkspaceDetail, CloudWorkspaceSummary } from "@proliferate/cloud-sdk";

import type {
  CloudCommandReadinessView,
  RecentWorkCloudAccessState,
  RecentWorkCommandability,
  RecentWorkRuntimeLocation,
} from "./cloud-work-inventory-types";
import { commandStatusDetailMessage } from "./cloud-work-text";

export type CloudWorkspaceCommandFacts = Pick<
  CloudWorkspaceSummary,
    | "exposure"
    | "exposureState"
    | "runtime"
    | "sandboxType"
    | "targetId"
    | "visibility"
    | "workspaceStatus"
    | "status"
  > &
  Partial<Pick<CloudWorkspaceSummary, "lastError" | "statusDetail">> &
  Partial<Pick<CloudWorkspaceDetail, "anyharnessWorkspaceId">>;

export function recentWorkRuntimeLocationForWorkspace(
  workspace: Pick<CloudWorkspaceSummary, "sandboxType" | "runtime" | "exposureState">,
): RecentWorkRuntimeLocation {
  if (workspace.exposureState === "stale" || workspace.exposureState === "paused" || workspace.exposureState === "revoked") {
    return "offline";
  }
  if (workspace.runtime?.status === "disabled" || workspace.runtime?.status === "error") {
    return "offline";
  }
  switch (workspace.sandboxType) {
    case "local":
      return "local_desktop";
    case "managed_personal":
    case "managed_shared":
      return "cloud_sandbox";
    case "ssh":
    case "self_hosted":
      return "ssh_remote";
    case undefined:
      return "unknown";
  }
}

export function recentWorkCloudAccessState(
  workspace: Pick<CloudWorkspaceSummary, "exposure" | "exposureState" | "sandboxType">,
): RecentWorkCloudAccessState {
  if (workspace.exposure) {
    return "enabled";
  }
  if (workspace.sandboxType === "managed_personal" || workspace.sandboxType === "managed_shared") {
    return "enabled";
  }
  switch (workspace.exposureState) {
    case "live":
    case "tracked":
    case "paused":
    case "stale":
    case "revoked":
      return "enabled";
    case "untracked":
      return "not_enabled";
    case undefined:
      return "unknown";
  }
}

export function recentWorkCommandability(
  workspace: Pick<
    CloudWorkspaceSummary,
    | "exposure"
    | "exposureState"
    | "runtime"
    | "sandboxType"
    | "targetId"
    | "visibility"
    | "workspaceStatus"
    | "status"
  >,
): RecentWorkCommandability {
  if (workspace.visibility === "shared_unclaimed") {
    return "not_commandable";
  }
  if (
    workspace.workspaceStatus === "error" ||
    workspace.status === "error" ||
    workspace.runtime?.status === "error" ||
    workspace.runtime?.status === "disabled"
  ) {
    return "not_commandable";
  }
  if (
    workspace.exposureState === "stale" ||
    workspace.exposureState === "paused" ||
    workspace.exposureState === "revoked"
  ) {
    return "stale";
  }
  if (
    workspace.exposure?.commandable === true &&
    workspace.exposure.status === "active" &&
    (workspace.exposureState === "live" || workspace.exposureState === "tracked")
  ) {
    return "commandable";
  }
  if (workspace.sandboxType === "managed_personal" || workspace.sandboxType === "managed_shared") {
    return workspace.targetId
      && workspace.runtime?.status === "running"
      && (workspace.workspaceStatus === "ready" || workspace.status === "ready")
      ? "commandable"
      : "not_commandable";
  }
  if (
    workspace.sandboxType === "local" ||
    workspace.sandboxType === "ssh" ||
    workspace.sandboxType === "self_hosted"
  ) {
    return "not_commandable";
  }
  return "unknown";
}

export function cloudCommandReadiness(
  workspace: CloudWorkspaceCommandFacts,
): CloudCommandReadinessView {
  const statusDetail = commandStatusDetailMessage(workspace.statusDetail);
  if (workspace.visibility === "shared_unclaimed") {
    return {
      state: "claim_required",
      commandable: false,
      message: "Claim this shared workspace before sending prompts or changing session settings.",
    };
  }
  if (
    workspace.workspaceStatus === "error" ||
    workspace.status === "error" ||
    workspace.runtime?.status === "error" ||
    workspace.runtime?.status === "disabled"
  ) {
    return {
      state: "runtime_unavailable",
      commandable: false,
      message: workspace.lastError
        ?? statusDetail
        ?? "This workspace cannot accept cloud commands right now.",
    };
  }
  if (workspace.workspaceStatus !== "ready" && workspace.status !== "ready") {
    return {
      state: "workspace_not_ready",
      commandable: false,
      message: statusDetail ?? "Workspace runtime is not ready yet. Try again when setup finishes.",
    };
  }
  const activeExposureCommandable =
    workspace.exposure?.commandable === true &&
    workspace.exposure.status === "active" &&
    (workspace.exposureState === "live" || workspace.exposureState === "tracked");
  const managedWorkspace =
    workspace.sandboxType === "managed_personal" || workspace.sandboxType === "managed_shared";
  const routedManagedWorkspace =
    managedWorkspace && Boolean(workspace.targetId && workspace.anyharnessWorkspaceId);
  if (activeExposureCommandable && (routedManagedWorkspace || !managedWorkspace)) {
    return {
      state: "ready",
      commandable: true,
      message: null,
    };
  }
  const runtimeLocation = recentWorkRuntimeLocationForWorkspace(workspace);
  if (runtimeLocation === "offline" || recentWorkCommandability(workspace) === "stale") {
    return {
      state: "runtime_offline",
      commandable: false,
      message: "This is the same workspace, but its Desktop/remote runtime is offline. Open Desktop and enable remote access before sending commands from Web or Mobile.",
    };
  }
  if (workspace.sandboxType === "managed_personal" || workspace.sandboxType === "managed_shared") {
    if (workspace.runtime?.status !== "running") {
      return {
        state: "workspace_not_ready",
        commandable: false,
        message: "Cloud runtime is still starting. Try again when it is running.",
      };
    }
    if (!workspace.targetId || !workspace.anyharnessWorkspaceId) {
      return {
        state: "runtime_unavailable",
        commandable: false,
        message: "Workspace is ready but missing runtime command routing.",
      };
    }
    return {
      state: "ready",
      commandable: true,
      message: null,
    };
  }
  if (recentWorkCommandability(workspace) === "unknown") {
    return {
      state: "commandability_unknown",
      commandable: false,
      message: "This workspace does not yet report a commandable runtime. Refresh after the target comes online.",
    };
  }
  return {
    state: "runtime_unavailable",
    commandable: false,
    message: "This workspace cannot accept cloud commands right now.",
  };
}

export function cloudWorkspaceRuntimeIsInProgress(
  workspace: Pick<CloudWorkspaceSummary, "runtime" | "sandboxType">
    & Partial<Pick<CloudWorkspaceSummary, "directTargetContext">>,
): boolean {
  if (workspace.runtime?.status !== "pending" && workspace.runtime?.status !== "provisioning") {
    return false;
  }
  if (workspace.runtime.environmentId) {
    return true;
  }
  return !workspaceUsesDirectTargetRuntime(workspace);
}

function workspaceUsesDirectTargetRuntime(
  workspace: Pick<CloudWorkspaceSummary, "sandboxType">
    & Partial<Pick<CloudWorkspaceSummary, "directTargetContext">>,
): boolean {
  return Boolean(workspace.directTargetContext)
    || workspace.sandboxType === "local"
    || workspace.sandboxType === "ssh"
    || workspace.sandboxType === "self_hosted";
}
