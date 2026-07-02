import type { Workspace } from "@anyharness/sdk";
import type { ComputeTargetAppearance } from "@/lib/domain/compute/target-appearance";
import type {
  CloudWorkspaceExposureState,
  CloudWorkspaceVisibility,
} from "@/lib/domain/workspaces/cloud/cloud-workspace-model";
import type { LogicalWorkspace } from "@/lib/domain/workspaces/cloud/logical-workspace-model";
import { automationWorkspaceDefaultDisplayNameFromBranch } from "@/lib/domain/workspaces/display/workspace-display";
import type { SidebarCloudWorkspaceSummary } from "@/lib/domain/workspaces/sidebar/cloud-workspace";
import {
  logicalWorkspaceSshTargetId,
  type SidebarDetailIndicator,
  type SidebarWorkspaceVariant,
} from "@/lib/domain/workspaces/sidebar/sidebar-indicators";

type SidebarCreatorContext =
  | {
    kind: "human";
    label?: string | null;
  }
  | {
    kind: "automation";
    automationId?: string | null;
    automationRunId?: string | null;
    label?: string | null;
  }
  | {
    kind: "agent";
    sourceSessionId?: string | null;
    sourceSessionWorkspaceId?: string | null;
    sessionLinkId?: string | null;
    sourceWorkspaceId?: string | null;
    label?: string | null;
  };

type SidebarOriginContext = {
  kind: string;
  entrypoint: string;
} | null | undefined;

type WorkspaceWithCreatorContext = {
  creatorContext?: SidebarCreatorContext | null;
  origin?: SidebarOriginContext;
};

export function detailIndicatorsForWorkspace(
  workspace: LogicalWorkspace,
  variant: SidebarWorkspaceVariant,
  targetAppearance?: ComputeTargetAppearance | null,
): SidebarDetailIndicator[] {
  const creator = creatorDetailIndicator(workspace);
  const cloudAccess = cloudAccessDetailIndicator(workspace);
  const cloudExposure = cloudExposureDetailIndicator(workspace);
  const origin = originDetailIndicator(workspace, creator);
  return [
    ...(creator ? [creator] : []),
    ...(origin ? [origin] : []),
    ...(cloudAccess ? [cloudAccess] : []),
    ...(cloudExposure ? [cloudExposure] : []),
    {
      kind: "materialization" as const,
      variant,
      tooltip: materializationTooltip(variant, targetAppearance),
      targetAppearance: variant === "ssh" ? targetAppearance ?? null : null,
      directTargetId: variant === "ssh" ? logicalWorkspaceSshTargetId(workspace) : null,
    },
  ];
}

function activeCreatorContext(workspace: LogicalWorkspace): SidebarCreatorContext | null {
  const materialization = workspace.effectiveOwner === "cloud"
    ? workspace.cloudWorkspace
    : workspace.localWorkspace;
  return (materialization as WorkspaceWithCreatorContext | null | undefined)?.creatorContext ?? null;
}

function activeOrigin(workspace: LogicalWorkspace): SidebarOriginContext {
  const materialization = workspace.effectiveOwner === "cloud"
    ? workspace.cloudWorkspace
    : workspace.localWorkspace;
  return (materialization as WorkspaceWithCreatorContext | null | undefined)?.origin ?? null;
}

function creatorDetailIndicator(workspace: LogicalWorkspace): SidebarDetailIndicator | null {
  const creatorContext = activeCreatorContext(workspace);

  if (creatorContext?.kind === "automation") {
    const label = creatorContext.label?.trim();
    return {
      kind: "automation",
      tooltip: label
        ? `Created by workflow · ${label}`
        : "Created by workflow",
      action: {
        kind: "open_automations",
        automationId: creatorContext.automationId ?? null,
        automationRunId: creatorContext.automationRunId ?? null,
      },
    };
  }

  if (creatorContext?.kind === "agent") {
    const label = creatorContext.label?.trim();
    const sourceSessionId = creatorContext.sourceSessionId?.trim();
    const sourceSessionWorkspaceId = creatorContext.sourceSessionWorkspaceId?.trim();
    return {
      kind: "agent",
      tooltip: label
        ? `Created by another agent · ${label}`
        : sourceSessionId && sourceSessionWorkspaceId
          ? "Created by another agent · open source session"
          : "Created by another agent",
      action: sourceSessionId && sourceSessionWorkspaceId
        ? {
          kind: "open_source_session",
          workspaceId: sourceSessionWorkspaceId,
          sessionId: sourceSessionId,
        }
        : null,
    };
  }

  if (workspace.effectiveOwner === "cloud") {
    const cloudWorkspace = workspace.cloudWorkspace;
    if (cloudWorkspace && cloudWorkspaceCreatedByAutomation(cloudWorkspace)) {
      return {
        kind: "automation",
        tooltip: "Created by workflow",
        action: { kind: "open_automations" },
      };
    }
  } else {
    const localWorkspace = workspace.localWorkspace;
    if (localWorkspace && localWorkspaceCreatedByAutomation(localWorkspace)) {
      return {
        kind: "automation",
        tooltip: "Created by workflow",
        action: { kind: "open_automations" },
      };
    }
  }

  const origin = activeOrigin(workspace);
  if (origin?.kind === "cowork" || origin?.entrypoint === "cowork") {
    return {
      kind: "agent",
      tooltip: "Created by another agent",
      action: null,
    };
  }

  return null;
}

function activeCloudWorkspace(workspace: LogicalWorkspace): SidebarCloudWorkspaceSummary | null {
  return workspace.effectiveOwner === "cloud"
    ? workspace.cloudWorkspace ?? null
    : null;
}

function cloudAccessDetailIndicator(workspace: LogicalWorkspace): SidebarDetailIndicator | null {
  const cloudWorkspace = activeCloudWorkspace(workspace);
  const visibility = cloudWorkspace?.visibility;
  if (!visibility || visibility === "private") {
    return null;
  }

  return {
    kind: "cloud_access",
    tone: cloudAccessTone(visibility),
    tooltip: cloudAccessTooltip(cloudWorkspace),
  };
}

function cloudExposureDetailIndicator(workspace: LogicalWorkspace): SidebarDetailIndicator | null {
  const exposureState = workspace.cloudWorkspace?.exposureState;
  if (!exposureState) {
    return null;
  }

  return {
    kind: "cloud_exposure",
    tone: cloudExposureTone(exposureState),
    tooltip: cloudExposureTooltip(exposureState),
  };
}

function originDetailIndicator(
  workspace: LogicalWorkspace,
  creator: SidebarDetailIndicator | null,
): SidebarDetailIndicator | null {
  if (creator?.kind === "automation" || creator?.kind === "agent") {
    return null;
  }

  const tooltip = originTooltip(activeOrigin(workspace));
  return tooltip
    ? {
      kind: "origin",
      tooltip,
    }
    : null;
}

function cloudAccessTone(
  visibility: CloudWorkspaceVisibility,
): Extract<SidebarDetailIndicator, { kind: "cloud_access" }>["tone"] {
  switch (visibility) {
    case "shared_unclaimed":
      return "warning";
    case "claimed":
      return "success";
    case "archived":
      return "muted";
    case "private":
    default:
      return "neutral";
  }
}

function cloudAccessTooltip(workspace: SidebarCloudWorkspaceSummary): string {
  switch (workspace.visibility) {
    case "shared_unclaimed":
      return "Shared team work · unclaimed";
    case "claimed":
      return workspace.claimedByUserId
        ? `Claimed shared work · ${workspace.claimedByUserId}`
        : "Claimed shared work";
    case "archived":
      return "Archived cloud work";
    case "private":
    default:
      return "Private cloud work";
  }
}

function cloudExposureTone(
  exposureState: CloudWorkspaceExposureState,
): Extract<SidebarDetailIndicator, { kind: "cloud_exposure" }>["tone"] {
  switch (exposureState) {
    case "live":
    case "tracked":
      return "neutral";
    case "paused":
    case "stale":
      return "warning";
    case "revoked":
    case "untracked":
      return "muted";
    default:
      return "neutral";
  }
}

function cloudExposureTooltip(exposureState: CloudWorkspaceExposureState): string {
  switch (exposureState) {
    case "live":
      return "Cloud access enabled · live";
    case "tracked":
      return "Cloud access enabled";
    case "paused":
      return "Cloud access paused";
    case "stale":
      return "Cloud access stale";
    case "revoked":
      return "Cloud access revoked";
    case "untracked":
    default:
      return "Cloud access disabled";
  }
}

function originTooltip(origin: SidebarOriginContext): string | null {
  switch (origin?.entrypoint) {
    case "web":
      return "Started from Web";
    case "mobile":
      return "Started from Mobile";
    case "slack":
      return "Started from Slack";
    case "api":
      return "Started from API";
    case "cowork":
      return "Started by cowork";
    case "local_runtime":
      return "Started from local runtime";
    case "desktop":
    case "cloud":
    default:
      return null;
  }
}

function isSystemOrigin(
  origin: SidebarOriginContext,
  entrypoint: "desktop" | "cloud",
): boolean {
  return origin?.kind === "system" && origin.entrypoint === entrypoint;
}

function localWorkspaceCreatedByAutomation(workspace: Workspace): boolean {
  const currentBranch = workspace.currentBranch?.trim();
  const originalBranch = workspace.originalBranch?.trim();
  return isSystemOrigin(workspace.origin, "desktop")
    && (
      isAutomationBranch(currentBranch)
      || isAutomationBranch(originalBranch)
      || false
    );
}

function cloudWorkspaceCreatedByAutomation(workspace: SidebarCloudWorkspaceSummary): boolean {
  return isSystemOrigin(workspace.origin, "cloud");
}

function isAutomationBranch(branchName: string | null | undefined): boolean {
  const branch = branchName?.trim();
  return Boolean(
    branch
    && (
      automationWorkspaceDefaultDisplayNameFromBranch(branch)
      || branch.startsWith("automation/")
    ),
  );
}

function materializationTooltip(
  variant: SidebarWorkspaceVariant,
  targetAppearance?: ComputeTargetAppearance | null,
): string {
  switch (variant) {
    case "ssh":
      return targetAppearance
        ? `SSH target · ${targetAppearance.displayName}`
        : "SSH target · runs on a connected target";
    case "cloud":
      return "Cloud · runs on remote infrastructure";
    case "worktree":
      return "Worktree · isolated branch in a separate checkout";
    case "local":
    default:
      return "Local · runs in the repo's working directory";
  }
}
