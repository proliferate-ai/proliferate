import type {
  CreatePullRequestRequest,
  CurrentPullRequestResponse,
  GitChangedFile,
  GitStatusSnapshot,
} from "@anyharness/sdk";

export type PublishIntent = "commit" | "publish" | "pull_request";

export interface PublishCommitDraft {
  summary: string;
  includeUnstaged: boolean;
}

export interface PublishPullRequestDraft {
  title: string;
  body: string;
  baseBranch: string;
  draft: boolean;
}

export type PublishWorkflowStep =
  | { kind: "stage"; paths: string[] }
  | { kind: "commit"; summary: string }
  | { kind: "push" }
  | { kind: "create_pull_request"; request: CreatePullRequestRequest };

export interface PublishFileGroups {
  staged: GitChangedFile[];
  partial: GitChangedFile[];
  unstaged: GitChangedFile[];
}

export interface PublishViewState {
  branchName: string | null;
  defaultBaseBranch: string;
  existingPr: NonNullable<CurrentPullRequestResponse["pullRequest"]> | null;
  fileGroups: PublishFileGroups;
  hasPartialFiles: boolean;
  hasStagedChanges: boolean;
  hasUnstagedChanges: boolean;
  partialWarning: string | null;
  publishStatus: string | null;
  primaryLabel: string;
  disabledReason: string | null;
  workflowSteps: PublishWorkflowStep[];
}

export interface BuildPublishViewStateInput {
  gitStatus: GitStatusSnapshot | null | undefined;
  existingPr: NonNullable<CurrentPullRequestResponse["pullRequest"]> | null;
  runtimeBlockedReason: string | null;
  repoDefaultBranch: string | null;
  initialIntent: PublishIntent;
  commitDraft: PublishCommitDraft;
  pullRequestDraft: PublishPullRequestDraft;
}

const PARTIAL_WARNING =
  "Including unstaged changes will also include all unstaged hunks in partially staged files.";
const PARTIAL_STAGED_ONLY_WARNING =
  "Partially staged files can show combined file totals; with Include unstaged off, only staged hunks are committed.";

export function defaultPublishPullRequestDraft(input: {
  gitStatus: GitStatusSnapshot | null | undefined;
  repoDefaultBranch: string | null;
}): PublishPullRequestDraft {
  const baseBranch = input.gitStatus?.suggestedBaseBranch?.trim()
    || input.repoDefaultBranch?.trim()
    || "main";
  return {
    title: "",
    body: "",
    baseBranch,
    draft: false,
  };
}

export function buildPublishViewState(input: BuildPublishViewStateInput): PublishViewState {
  const gitStatus = input.gitStatus ?? null;
  const existingPr = input.existingPr ?? null;
  const defaultBaseBranch = gitStatus?.suggestedBaseBranch?.trim()
    || input.repoDefaultBranch?.trim()
    || "main";
  const fileGroups = groupPublishFiles(gitStatus?.files ?? []);
  const hasPartialFiles = fileGroups.partial.length > 0;
  const hasStagedChanges = fileGroups.staged.length > 0 || fileGroups.partial.length > 0;
  const hasUnstagedChanges = fileGroups.unstaged.length > 0 || fileGroups.partial.length > 0;
  const wantsPr = input.initialIntent === "pull_request";
  const wantsPublish = input.initialIntent === "publish" || wantsPr;
  const summary = input.commitDraft.summary.trim();
  const branchName = gitStatus?.currentBranch?.trim() || null;
  const hasDirtyChanges = hasStagedChanges || hasUnstagedChanges;
  const partialWarning = partialFileWarning(hasPartialFiles, input.commitDraft.includeUnstaged);
  const publishStatus = publishStatusLabel({
    gitStatus,
    wantsPublish,
    hasDirtyChanges,
  });

  const disabledReason = resolveDisabledReason({
    gitStatus,
    runtimeBlockedReason: input.runtimeBlockedReason,
    branchName,
    summary,
    wantsPublish,
    wantsPr,
    hasStagedChanges,
    hasUnstagedChanges,
    includeUnstaged: input.commitDraft.includeUnstaged,
    existingPr,
    pullRequestDraft: input.pullRequestDraft,
  });
  const needsPush = shouldPush({
    gitStatus,
    wantsPublish,
    wantsPr,
    hasDirtyChanges,
  });

  const workflowSteps = disabledReason
    ? []
    : buildWorkflowSteps({
      fileGroups,
      includeUnstaged: input.commitDraft.includeUnstaged,
      summary,
      wantsPublish,
      wantsPr,
      needsPush,
      existingPr,
      pullRequestDraft: input.pullRequestDraft,
      hasStagedChanges,
      hasUnstagedChanges,
    });

  return {
    branchName,
    defaultBaseBranch,
    existingPr,
    fileGroups,
    hasPartialFiles,
    hasStagedChanges,
    hasUnstagedChanges,
    partialWarning,
    publishStatus,
    primaryLabel: primaryLabel({
      intent: input.initialIntent,
      gitStatus,
      existingPr,
      hasDirtyChanges,
      workflowSteps,
    }),
    disabledReason,
    workflowSteps,
  };
}

function partialFileWarning(hasPartialFiles: boolean, includeUnstaged: boolean): string | null {
  if (!hasPartialFiles) return null;
  return includeUnstaged ? PARTIAL_WARNING : PARTIAL_STAGED_ONLY_WARNING;
}

function publishStatusLabel(input: {
  gitStatus: GitStatusSnapshot | null;
  wantsPublish: boolean;
  hasDirtyChanges: boolean;
}): string | null {
  if (!input.gitStatus || !input.wantsPublish || input.hasDirtyChanges) return null;
  const upstream = input.gitStatus.upstreamBranch?.trim() || null;
  if (input.gitStatus.ahead > 0 && upstream) {
    return `Push ${input.gitStatus.ahead} local commit${input.gitStatus.ahead === 1 ? "" : "s"} to ${upstream}.`;
  }
  if (!upstream && input.gitStatus.actions.canPush) {
    return "Publish this branch and set its upstream.";
  }
  if (upstream) {
    return `This branch is up to date with ${upstream}.`;
  }
  return "This branch has no upstream yet.";
}

function groupPublishFiles(files: GitChangedFile[]): PublishFileGroups {
  const publishable = files.filter((file) =>
    file.path.length > 0 && !file.path.startsWith(".claude/worktrees/")
  );
  return {
    staged: publishable.filter((file) => file.includedState === "included"),
    partial: publishable.filter((file) => file.includedState === "partial"),
    unstaged: publishable.filter((file) => file.includedState === "excluded"),
  };
}

function resolveDisabledReason(input: {
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

function shouldPush(input: {
  gitStatus: GitStatusSnapshot | null;
  wantsPublish: boolean;
  wantsPr: boolean;
  hasDirtyChanges: boolean;
}): boolean {
  if (!input.wantsPublish && !input.wantsPr) return false;
  if (input.hasDirtyChanges) return true;
  return input.gitStatus?.actions.canPush ?? false;
}

function buildWorkflowSteps(input: {
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

function primaryLabel(input: {
  intent: PublishIntent;
  gitStatus: GitStatusSnapshot | null;
  existingPr: NonNullable<CurrentPullRequestResponse["pullRequest"]> | null;
  hasDirtyChanges: boolean;
  workflowSteps: PublishWorkflowStep[];
}): string {
  if (input.intent === "pull_request") {
    if (input.existingPr && input.workflowSteps.length === 0) return "View pull request";
    const hasCommitStep = input.workflowSteps.some((step) => step.kind === "commit");
    const hasPushStep = input.workflowSteps.some((step) => step.kind === "push");
    const hasCreatePrStep = input.workflowSteps.some((step) => step.kind === "create_pull_request");
    if (hasCommitStep && hasPushStep && hasCreatePrStep) return "Commit, publish, create PR";
    if (hasPushStep && hasCreatePrStep) return "Publish and create PR";
    if (hasCreatePrStep) return hasCommitStep ? "Commit and create PR" : "Create PR";
    if (hasCommitStep && hasPushStep) {
      const label = input.gitStatus?.actions.pushLabel ?? "Publish";
      return `Commit and ${label.toLowerCase()}`;
    }
    if (hasPushStep) return input.gitStatus?.actions.pushLabel ?? "Publish";
    return input.existingPr ? "View pull request" : "Create PR";
  }
  if (input.intent === "publish") {
    const label = input.gitStatus?.actions.pushLabel ?? "Publish";
    return input.hasDirtyChanges ? `Commit and ${label.toLowerCase()}` : label;
  }
  return "Commit";
}
