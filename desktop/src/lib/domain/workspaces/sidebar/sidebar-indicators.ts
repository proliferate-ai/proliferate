import type { Workspace } from "@anyharness/sdk";
import type { SidebarSessionActivityState } from "@proliferate/product-model/sessions/activity";
import { resolveWorkspaceExecutionSidebarActivityState } from "@proliferate/product-model/sessions/activity";
import type { ComputeTargetAppearance } from "@/lib/domain/compute/target-appearance";
import { isCloudWorkspacePending } from "@/lib/domain/workspaces/cloud/cloud-workspace-status";
import type {
  CloudWorkspaceExposureState,
  CloudWorkspaceVisibility,
} from "@/lib/domain/workspaces/cloud/cloud-workspace-model";
import type { LogicalWorkspace } from "@/lib/domain/workspaces/cloud/logical-workspace-model";
import { automationWorkspaceDefaultDisplayNameFromBranch } from "@/lib/domain/workspaces/display/workspace-display";
import { cloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";
import type { SidebarCloudWorkspaceSummary } from "./cloud-workspace";

export type SidebarWorkspaceVariant = "local" | "worktree" | "cloud" | "ssh";

export type SidebarIndicatorAction =
  | { kind: "open_workspace"; workspaceId: string }
  | {
    kind: "open_automations";
    automationId?: string | null;
    automationRunId?: string | null;
  }
  | {
    kind: "open_source_session";
    workspaceId: string;
    sessionId: string;
  }
  | {
    kind: "mark_workspace_done";
    workspaceId: string;
    logicalWorkspaceId?: string | null;
  }
  | {
    kind: "keep_workspace_active";
    workspaceId: string;
    readinessFingerprint: string;
  };

export type SidebarStatusIndicator =
  | {
    kind: "error";
    tooltip: string;
    action?: SidebarIndicatorAction | null;
  }
  | {
    kind: "waiting_input";
    tooltip: string;
  }
  | {
    kind: "waiting_plan";
    tooltip: string;
  }
  | {
    kind: "iterating";
    tooltip: string;
  }
  | {
    kind: "queued_prompt";
    tooltip: string;
  }
  | {
    kind: "needs_review";
    tooltip: string;
  };

export type SidebarDetailIndicator =
  | {
    kind: "automation";
    tooltip: string;
    action?: SidebarIndicatorAction | null;
  }
  | {
    kind: "agent";
    tooltip: string;
    action?: SidebarIndicatorAction | null;
  }
  | {
    kind: "materialization";
    variant: SidebarWorkspaceVariant;
    tooltip: string;
    targetAppearance?: ComputeTargetAppearance | null;
  }
  | {
    kind: "cloud_access";
    tone: "neutral" | "success" | "warning" | "muted";
    tooltip: string;
  }
  | {
    kind: "cloud_exposure";
    tone: "neutral" | "success" | "warning" | "muted";
    tooltip: string;
  }
  | {
    kind: "origin";
    tooltip: string;
  }
  | {
    kind: "finish_suggestion";
    workspaceId: string;
    logicalWorkspaceId: string;
    readinessFingerprint: string;
    tooltip: string;
  };

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

export function sidebarWorkspaceVariantForLogicalWorkspace(
  workspace: LogicalWorkspace,
): SidebarWorkspaceVariant {
  if (logicalWorkspaceUsesSshTarget(workspace)) {
    return "ssh";
  }
  return workspace.effectiveOwner === "cloud"
    ? "cloud"
    : workspace.localWorkspace?.kind === "worktree"
      ? "worktree"
      : "local";
}

export function logicalWorkspaceUsesSshTarget(workspace: LogicalWorkspace): boolean {
  return workspace.lifecycle === "ssh_active"
    || workspace.cloudWorkspace?.sandboxType === "ssh"
    || workspace.cloudWorkspace?.directTargetContext?.targetKind === "ssh";
}

export function logicalWorkspaceSshTargetId(workspace: LogicalWorkspace): string | null {
  return workspace.cloudWorkspace?.directTargetContext?.targetId
    ?? workspace.cloudWorkspace?.targetId
    ?? null;
}

export function sidebarStatusIndicatorFromActivity(args: {
  activity: SidebarSessionActivityState;
  needsReview?: boolean;
  pendingPromptCount?: number;
  errorAction?: SidebarIndicatorAction | null;
}): SidebarStatusIndicator | null {
  const {
    activity,
    needsReview = false,
    pendingPromptCount = 0,
    errorAction = null,
  } = args;

  switch (activity) {
    case "error":
      return {
        kind: "error",
        tooltip: errorAction ? "Error · open workspace" : "Error",
        action: errorAction,
      };
    case "waiting_input":
      return {
        kind: "waiting_input",
        tooltip: "Waiting for input",
      };
    case "waiting_plan":
      return {
        kind: "waiting_plan",
        tooltip: "Waiting for plan approval",
      };
    case "iterating":
      return {
        kind: "iterating",
        tooltip: "Iterating",
      };
    case "closed":
    case "idle":
      break;
  }

  if (pendingPromptCount > 0) {
    return {
      kind: "queued_prompt",
      tooltip: pendingPromptCount === 1
        ? "Queued Home prompt"
        : `${pendingPromptCount} queued Home prompts`,
    };
  }

  return needsReview
    ? {
      kind: "needs_review",
      tooltip: "Needs review",
    }
    : null;
}

export function activeWorkspaceActivity(
  workspace: LogicalWorkspace,
  workspaceActivities: Record<string, SidebarSessionActivityState>,
): SidebarSessionActivityState {
  if (workspace.effectiveOwner === "cloud") {
    const cloudWorkspace = workspace.cloudWorkspace;
    if (!cloudWorkspace) {
      return "idle";
    }

    const sessionActivity =
      workspaceActivities[cloudWorkspaceSyntheticId(cloudWorkspace.id)] ?? "idle";
    const cloudActivity = cloudWorkspace.status === "error"
      ? "error"
      : isCloudWorkspacePending(cloudWorkspace.status)
        ? "iterating"
        : "idle";
    return higherPrioritySidebarActivity(sessionActivity, cloudActivity);
  }

  const localWorkspace = workspace.localWorkspace;
  if (!localWorkspace) {
    return "idle";
  }

  return mergeLocalWorkspaceActivity(
    workspaceActivities[localWorkspace.id],
    localWorkspace.executionSummary ?? null,
  );
}

export function detailIndicatorsForWorkspace(
  workspace: LogicalWorkspace,
  variant: SidebarWorkspaceVariant,
  finishSuggestion?: { workspaceId: string; readinessFingerprint: string } | null,
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
    ...(finishSuggestion
      ? [{
        kind: "finish_suggestion" as const,
        workspaceId: finishSuggestion.workspaceId,
        logicalWorkspaceId: workspace.id,
        readinessFingerprint: finishSuggestion.readinessFingerprint,
        tooltip: "Ready to delete workspace",
      }]
      : []),
    {
      kind: "materialization" as const,
      variant,
      tooltip: materializationTooltip(variant, targetAppearance),
      targetAppearance: variant === "ssh" ? targetAppearance ?? null : null,
    },
  ];
}

function higherPrioritySidebarActivity(
  a: SidebarSessionActivityState,
  b: SidebarSessionActivityState,
): SidebarSessionActivityState {
  return sidebarActivityPriority(a) >= sidebarActivityPriority(b) ? a : b;
}

function mergeLocalWorkspaceActivity(
  mountedActivity: SidebarSessionActivityState | undefined,
  executionSummary: Workspace["executionSummary"] | null,
): SidebarSessionActivityState {
  if (mountedActivity === undefined) {
    return resolveWorkspaceExecutionSidebarActivityState(executionSummary);
  }

  if (
    (mountedActivity === "idle" || mountedActivity === "closed")
    && workspaceSummaryHasRunningSession(executionSummary)
  ) {
    return "iterating";
  }

  return mountedActivity;
}

function workspaceSummaryHasRunningSession(
  summary: Workspace["executionSummary"] | null,
): boolean {
  return (summary?.runningCount ?? 0) > 0 || summary?.phase === "running";
}

function sidebarActivityPriority(activity: SidebarSessionActivityState): number {
  switch (activity) {
    case "error":
      return 5;
    case "waiting_input":
      return 4;
    case "waiting_plan":
      return 3;
    case "iterating":
      return 2;
    case "closed":
      return 1;
    case "idle":
    default:
      return 0;
  }
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
        ? `Created by automation · ${label}`
        : "Created by automation",
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
        tooltip: "Created by automation",
        action: { kind: "open_automations" },
      };
    }
  } else {
    const localWorkspace = workspace.localWorkspace;
    if (localWorkspace && localWorkspaceCreatedByAutomation(localWorkspace)) {
      return {
        kind: "automation",
        tooltip: "Created by automation",
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
      return "Cloud projection live";
    case "tracked":
      return "Tracked by Cloud";
    case "paused":
      return "Cloud projection paused";
    case "stale":
      return "Cloud projection stale";
    case "revoked":
      return "Cloud projection revoked";
    case "untracked":
    default:
      return "Not tracked by Cloud";
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
