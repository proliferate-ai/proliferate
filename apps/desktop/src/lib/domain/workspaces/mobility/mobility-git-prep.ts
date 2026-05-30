import type { GitStatusSnapshot } from "@anyharness/sdk";
import {
  groupPublishFiles,
  partialFileWarning,
} from "@/lib/domain/workspaces/creation/publish-file-groups";
import {
  buildPublishWorkflowSteps,
  shouldPush,
} from "@/lib/domain/workspaces/creation/publish-workflow-steps";
import type {
  PublishCommitDraft,
  PublishFileGroups,
  PublishWorkflowStep,
} from "@/lib/domain/workspaces/creation/publish-workflow-model";
import type { WorkspaceMobilityDirection } from "@/lib/domain/workspaces/mobility/types";

export interface MobilityGitPrepViewState {
  branchName: string | null;
  fileGroups: PublishFileGroups;
  hasPartialFiles: boolean;
  hasStagedChanges: boolean;
  hasUnstagedChanges: boolean;
  partialWarning: string | null;
  primaryLabel: string;
  disabledReason: string | null;
  workflowSteps: PublishWorkflowStep[];
}

export function defaultMobilityCommitMessage(
  _direction: WorkspaceMobilityDirection | null,
): string {
  return "Save workspace changes before move";
}

export function buildMobilityGitPrepViewState(input: {
  gitStatus: GitStatusSnapshot | null | undefined;
  runtimeBlockedReason: string | null;
  direction: WorkspaceMobilityDirection | null;
  commitDraft: PublishCommitDraft;
}): MobilityGitPrepViewState {
  const gitStatus = input.gitStatus ?? null;
  const fileGroups = groupPublishFiles(gitStatus?.files ?? []);
  const hasPartialFiles = fileGroups.partial.length > 0;
  const hasStagedChanges = fileGroups.staged.length > 0 || fileGroups.partial.length > 0;
  const hasUnstagedChanges = fileGroups.unstaged.length > 0 || fileGroups.partial.length > 0;
  const hasDirtyChanges = hasStagedChanges || hasUnstagedChanges;
  const branchName = gitStatus?.currentBranch?.trim() || null;
  const summary = input.commitDraft.summary.trim();
  const partialWarning = partialFileWarning(hasPartialFiles, input.commitDraft.includeUnstaged);
  const disabledReason = resolveMobilityGitPrepDisabledReason({
    gitStatus,
    runtimeBlockedReason: input.runtimeBlockedReason,
    branchName,
    summary,
    hasDirtyChanges,
    hasStagedChanges,
    hasUnstagedChanges,
    includeUnstaged: input.commitDraft.includeUnstaged,
  });
  const needsPush = shouldPush({
    gitStatus,
    wantsPublish: true,
    wantsPr: false,
    hasDirtyChanges,
  });
  const workflowSteps = disabledReason
    ? []
    : buildPublishWorkflowSteps({
      fileGroups,
      includeUnstaged: input.commitDraft.includeUnstaged,
      summary,
      wantsPublish: true,
      wantsPr: false,
      needsPush,
      existingPr: null,
      pullRequestDraft: {
        title: "",
        body: "",
        baseBranch: gitStatus?.suggestedBaseBranch?.trim() || "main",
        draft: false,
      },
      hasStagedChanges,
      hasUnstagedChanges,
    }).filter((step) => step.kind !== "create_pull_request");

  return {
    branchName,
    fileGroups,
    hasPartialFiles,
    hasStagedChanges,
    hasUnstagedChanges,
    partialWarning,
    primaryLabel: hasDirtyChanges ? "Commit, push, and move" : "Push and move",
    disabledReason,
    workflowSteps,
  };
}

function resolveMobilityGitPrepDisabledReason(input: {
  gitStatus: GitStatusSnapshot | null;
  runtimeBlockedReason: string | null;
  branchName: string | null;
  summary: string;
  hasDirtyChanges: boolean;
  hasStagedChanges: boolean;
  hasUnstagedChanges: boolean;
  includeUnstaged: boolean;
}): string | null {
  if (input.runtimeBlockedReason) return input.runtimeBlockedReason;
  if (!input.gitStatus) return "Git status is still loading.";
  if (input.gitStatus.conflicted || input.gitStatus.actions.reasonIfBlocked) {
    return input.gitStatus.actions.reasonIfBlocked ?? "Resolve conflicts before moving.";
  }
  if (input.gitStatus.detached || !input.branchName) {
    return "Switch to a branch before moving.";
  }
  if (input.gitStatus.operation !== "none") {
    return "Finish the current Git operation before moving.";
  }
  if (input.gitStatus.behind > 0) {
    return "Sync this branch before moving.";
  }

  if (input.hasDirtyChanges) {
    if (!input.includeUnstaged) {
      if (!input.hasStagedChanges) {
        return "Stage changes or include unstaged changes before committing.";
      }
      if (input.hasUnstagedChanges) {
        return "Include unstaged changes before moving, or clean them up in the Git panel.";
      }
    }
    if (!input.summary) {
      return "Enter a commit message.";
    }
    return null;
  }

  if (!input.gitStatus.actions.canPush) {
    return "This branch is already published.";
  }

  return null;
}
