import type { Workspace } from "@anyharness/sdk";
import type { SidebarSessionActivityState } from "@/lib/domain/sessions/activity";
import { resolveWorkspaceExecutionSidebarActivityState } from "@/lib/domain/sessions/activity";
import { isCloudWorkspacePending } from "@/lib/domain/workspaces/cloud-workspace-status";
import type { LogicalWorkspace } from "@/lib/domain/workspaces/logical-workspaces";
import { automationWorkspaceDefaultDisplayNameFromBranch } from "@/lib/domain/workspaces/workspace-display";
import type { CloudWorkspaceSummary } from "@/lib/integrations/cloud/client";
import { cloudWorkspaceSyntheticId } from "./cloud-ids";

export type SidebarWorkspaceVariant = "local" | "worktree" | "cloud";

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
  return workspace.effectiveOwner === "cloud"
    ? "cloud"
    : workspace.localWorkspace?.kind === "worktree"
      ? "worktree"
      : "local";
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
): SidebarDetailIndicator[] {
  const creator = creatorDetailIndicator(workspace);
  return [
    ...(creator ? [creator] : []),
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
      tooltip: materializationTooltip(variant),
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

function cloudWorkspaceCreatedByAutomation(workspace: CloudWorkspaceSummary): boolean {
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

function materializationTooltip(variant: SidebarWorkspaceVariant): string {
  switch (variant) {
    case "cloud":
      return "Cloud · runs on remote infrastructure";
    case "worktree":
      return "Worktree · isolated branch in a separate checkout";
    case "local":
    default:
      return "Local · runs in the repo's working directory";
  }
}
