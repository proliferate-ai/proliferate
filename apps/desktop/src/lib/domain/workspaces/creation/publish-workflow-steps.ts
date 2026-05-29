import type {
  CurrentPullRequestResponse,
  GitStatusSnapshot,
} from "@anyharness/sdk";
import type {
  PublishFileGroups,
  PublishPullRequestDraft,
  PublishWorkflowStep,
} from "@/lib/domain/workspaces/creation/publish-workflow-model";

export function resolvePublishDisabledReason(input: {
  gitStatus: GitStatusSnapshot | null;
  runtimeBlockedReason: string | null;
  branchName: string | null;
  summary: string;
  wantsPublish: boolean;
  wantsPr: boolean;
  hasStagedChanges: boolean;
  hasUnstagedChanges: boolean;
  includeUnstaged: boolean;
  existingPr: NonNullable<CurrentPullRequestResponse["pullRequest"]> | null;
  pullRequestDraft: PublishPullRequestDraft;
}): string | null {
  if (input.runtimeBlockedReason) return input.runtimeBlockedReason;
  if (!input.gitStatus) return "Git status is still loading.";
  if (input.gitStatus.conflicted || input.gitStatus.actions.reasonIfBlocked) {
    return input.gitStatus.actions.reasonIfBlocked ?? "Resolve conflicts before publishing.";
  }
  if (input.gitStatus.detached || !input.branchName) {
    return "Switch to a branch before publishing.";
  }
  if ((input.wantsPublish || input.wantsPr) && input.gitStatus.behind > 0) {
    return "Sync this branch before publishing.";
  }

  const hasDirtyChanges = input.hasStagedChanges || input.hasUnstagedChanges;
  if (hasDirtyChanges) {
    if (!input.includeUnstaged && !input.hasStagedChanges) {
      return "Stage changes or include unstaged changes before committing.";
    }
    if (!input.summary) {
      return "Enter a commit message.";
    }
  } else if (!input.wantsPublish && !input.wantsPr) {
    return "There are no changes to commit.";
  }

  if (input.wantsPr && !input.existingPr) {
    const baseBranch = input.pullRequestDraft.baseBranch.trim();
    if (!baseBranch) return "Choose a base branch.";
    if (sameBranch(input.branchName, baseBranch)) {
      return `Switch to a branch other than ${baseBranch} before creating a PR.`;
    }
  }

  const needsPush = shouldPush({
    gitStatus: input.gitStatus,
    wantsPublish: input.wantsPublish,
    wantsPr: input.wantsPr,
    hasDirtyChanges,
  });
  const canCreatePrOnly = input.wantsPr
    && !input.existingPr
    && !needsPush
    && input.gitStatus.actions.canCreatePullRequest;
  const canViewExistingPrOnly = input.wantsPr
    && input.existingPr
    && !needsPush;

  if (
    (input.wantsPublish || input.wantsPr)
    && !hasDirtyChanges
    && !needsPush
    && !canCreatePrOnly
    && !canViewExistingPrOnly
  ) {
    return "There are no local commits ready to publish.";
  }

  if (input.wantsPr && !input.existingPr) {
    if (!input.pullRequestDraft.title.trim()) return "Enter a pull request title.";
  }

  return null;
}

export function shouldPush(input: {
  gitStatus: GitStatusSnapshot | null;
  wantsPublish: boolean;
  wantsPr: boolean;
  hasDirtyChanges: boolean;
}): boolean {
  if (!input.wantsPublish && !input.wantsPr) return false;
  if (input.hasDirtyChanges) return true;
  return input.gitStatus?.actions.canPush ?? false;
}

export function buildPublishWorkflowSteps(input: {
  fileGroups: PublishFileGroups;
  includeUnstaged: boolean;
  summary: string;
  wantsPublish: boolean;
  wantsPr: boolean;
  needsPush: boolean;
  existingPr: NonNullable<CurrentPullRequestResponse["pullRequest"]> | null;
  pullRequestDraft: PublishPullRequestDraft;
  hasStagedChanges: boolean;
  hasUnstagedChanges: boolean;
}): PublishWorkflowStep[] {
  const steps: PublishWorkflowStep[] = [];
  const hasDirtyChanges = input.hasStagedChanges || input.hasUnstagedChanges;
  if (hasDirtyChanges) {
    if (input.includeUnstaged) {
      const paths = [
        ...input.fileGroups.unstaged.map((file) => file.path),
        ...input.fileGroups.partial.map((file) => file.path),
      ];
      if (paths.length > 0) steps.push({ kind: "stage", paths });
    }
    steps.push({ kind: "commit", summary: input.summary });
  }

  if (input.needsPush) {
    steps.push({ kind: "push" });
  }

  if (input.wantsPr && !input.existingPr) {
    steps.push({
      kind: "create_pull_request",
      request: {
        title: input.pullRequestDraft.title.trim(),
        body: input.pullRequestDraft.body.trim() || undefined,
        baseBranch: input.pullRequestDraft.baseBranch.trim(),
        draft: input.pullRequestDraft.draft,
      },
    });
  }

  return steps;
}

function sameBranch(left: string | null, right: string | null): boolean {
  const normalizedLeft = normalizeBranchName(left);
  const normalizedRight = normalizeBranchName(right);
  return normalizedLeft.length > 0 && normalizedLeft === normalizedRight;
}

function normalizeBranchName(branch: string | null): string {
  return (branch ?? "")
    .trim()
    .replace(/^refs\/heads\//, "")
    .replace(/^heads\//, "");
}
