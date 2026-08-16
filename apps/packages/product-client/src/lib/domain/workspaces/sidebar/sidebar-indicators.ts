import type { WorkflowRunStatusV2, Workspace } from "@anyharness/sdk";
import { recordMeasurementMetric } from "#product/lib/infra/measurement/measurement-port";
import { isMainThreadMeasurementEnabled } from "#product/lib/infra/measurement/measurement-port";
import type { SidebarSessionActivityState } from "#product/domain/sessions/activity";
import { resolveWorkspaceExecutionSidebarActivityState } from "#product/domain/sessions/activity";
import { missingCheckoutCopy } from "#product/copy/workspaces/workspace-availability-copy";
import { isCloudWorkspacePending } from "#product/lib/domain/workspaces/cloud/cloud-workspace-status";
import type { LogicalWorkspace } from "#product/lib/domain/workspaces/cloud/logical-workspace-model";
import { cloudWorkspaceSyntheticId } from "#product/lib/domain/workspaces/cloud/cloud-ids";
import { prStatusViewFromGitStatus } from "#product/lib/domain/workspaces/git-status/pr-status-presentation";
import type { WorkspaceGitStatus } from "#product/lib/domain/workspaces/git-status/workspace-git-status-model";

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
    kind: "worktree_missing";
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
    kind: "git_conflicts";
    tooltip: string;
  }
  | {
    kind: "git_checks_failing";
    tooltip: string;
  }
  | {
    kind: "git_changes_requested";
    tooltip: string;
  }
  | {
    kind: "workflow_run_succeeded";
    tooltip: string;
  }
  | {
    kind: "workflow_run_failed";
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

// A missing local checkout is a persistent workspace condition that outranks
// session-activity glyphs: the user should understand the workspace's state
// before opening it.
export function worktreeMissingStatusIndicator(
  workspaceKind: Workspace["kind"],
  action: SidebarIndicatorAction | null,
): SidebarStatusIndicator {
  return {
    kind: "worktree_missing",
    tooltip: missingCheckoutCopy(workspaceKind).title,
    action,
  };
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

/**
 * A terminal workflow run reads as a graph in the sidebar, not a duration:
 * the run's materialized workspace row carries a graph glyph tinted by
 * outcome. Non-terminal statuses return null on purpose — a moving run
 * already lights the row through its sessions' live activity, and this
 * indicator slots BELOW activity so a reopened workspace's new work wins.
 */
export function sidebarWorkflowRunIndicator(
  status: WorkflowRunStatusV2 | undefined,
): SidebarStatusIndicator | null {
  switch (status) {
    case "completed":
      return { kind: "workflow_run_succeeded", tooltip: "Run succeeded" };
    case "failed":
      return { kind: "workflow_run_failed", tooltip: "Run failed" };
    default:
      return null;
  }
}

export const SIDEBAR_GIT_CONFLICTS_LABEL = "Merge conflicts in worktree";

/**
 * Git attention as the status cell's last resort, below live activity.
 *
 * Attention surfaces here only when the identity glyph's state dot does not
 * already carry it: an open PR with failing checks is already a danger dot,
 * so repeating it in the status cell would say the same thing twice. Draft,
 * merged and closed PRs never resolve to those dot kinds, which is why their
 * failing checks and requested changes would otherwise go unreported.
 *
 * No ranking happens here: `deriveGitAttention` has already collapsed
 * conflicts > ci_failing > changes_requested into the single state it reports.
 */
export function sidebarGitAttentionIndicator(
  status: WorkspaceGitStatus | null,
): SidebarStatusIndicator | null {
  switch (status?.attention) {
    case "conflicts":
      return { kind: "git_conflicts", tooltip: SIDEBAR_GIT_CONFLICTS_LABEL };
    case "ci_failing":
      return prStatusViewFromGitStatus(status)?.kind === "checks_failing"
        ? null
        : { kind: "git_checks_failing", tooltip: "PR checks failing" };
    case "changes_requested":
      return prStatusViewFromGitStatus(status)?.kind === "changes_requested"
        ? null
        : { kind: "git_changes_requested", tooltip: "PR changes requested" };
    case "none":
    case undefined:
      return null;
  }
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
      || cloudWorkspace.status === "lost"
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
