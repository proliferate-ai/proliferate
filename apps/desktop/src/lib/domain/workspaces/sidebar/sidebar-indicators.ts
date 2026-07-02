import type { Workspace } from "@anyharness/sdk";
import { recordMeasurementMetric } from "@/lib/infra/measurement/debug-measurement";
import { isMainThreadMeasurementEnabled } from "@/lib/infra/measurement/debug-measurement-env";
import type { SidebarSessionActivityState } from "@proliferate/product-domain/sessions/activity";
import { resolveWorkspaceExecutionSidebarActivityState } from "@proliferate/product-domain/sessions/activity";
import type { ComputeTargetAppearance } from "@/lib/domain/compute/target-appearance";
import { isCloudWorkspacePending } from "@/lib/domain/workspaces/cloud/cloud-workspace-status";
import type { LogicalWorkspace } from "@/lib/domain/workspaces/cloud/logical-workspace-model";
import { cloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";

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
  pendingPromptCount?: number;
  errorAction?: SidebarIndicatorAction | null;
}): SidebarStatusIndicator | null {
  const {
    activity,
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

  return null;
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
    // SUSPECT for "sidebar spinner runs long after the agent finished": live
    // (mounted) session state says idle, but the server-side executionSummary
    // — which only refreshes on workspace-collections sync — still claims a
    // running session, and it wins here. The override exists for genuinely
    // running UNMOUNTED sessions, so it can't just be removed; this diagnostic
    // captures every occurrence (summary phase + runningCount) so dumps show
    // exactly how long stale summaries pin the spinner after live idle.
    if (isMainThreadMeasurementEnabled()) {
      recordMeasurementMetric({
        type: "diagnostic",
        category: "sidebar_activity",
        label: `summary_override.${executionSummary?.phase ?? "unknown"}`,
        count: executionSummary?.runningCount ?? 0,
      });
    }
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
