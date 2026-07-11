import type { GitStatusSnapshot } from "@anyharness/sdk";
import type {
  WorkspacePrChecks,
  WorkspacePrReviewDecision,
  WorkspacePrState,
} from "@/lib/domain/workspaces/git-status/workspace-git-status-model";

export type WorkspaceActivityTone = "default" | "attention" | "destructive";

export interface WorkspaceActivityFact {
  key: string;
  label: string;
  tone: WorkspaceActivityTone;
}

export interface WorkspaceActivityPullRequest {
  number: number | null;
  state: WorkspacePrState;
  checks: WorkspacePrChecks;
  reviewDecision: WorkspacePrReviewDecision;
}

export interface ComposerWorkspaceActivityModel {
  facts: WorkspaceActivityFact[];
  git: {
    branchName: string | null;
    changedFiles: number;
    stagedFiles: number;
    unstagedFiles: number;
    conflictedFiles: number;
    ahead: number;
    behind: number;
    changeLabel: string;
    stagingLabel: string | null;
    syncLabel: string | null;
    pullRequestLabel: string | null;
    pushLabel: string;
  } | null;
}

export function buildComposerWorkspaceActivityModel(input: {
  gitStatus: GitStatusSnapshot | null;
  pullRequest: WorkspaceActivityPullRequest | null;
}): ComposerWorkspaceActivityModel | null {
  const git = input.gitStatus ? buildGitDetail(input.gitStatus, input.pullRequest) : null;
  if (!git) {
    return null;
  }

  const facts = buildSummaryFacts({ git, pullRequest: input.pullRequest });
  return { facts, git };
}

function buildGitDetail(
  status: GitStatusSnapshot,
  pullRequest: WorkspaceActivityPullRequest | null,
): NonNullable<ComposerWorkspaceActivityModel["git"]> {
  let stagedFiles = 0;
  let unstagedFiles = 0;
  for (const file of status.files) {
    if (file.includedState === "included") {
      stagedFiles += 1;
    } else if (file.includedState === "partial") {
      stagedFiles += 1;
      unstagedFiles += 1;
    } else {
      unstagedFiles += 1;
    }
  }

  const changedFiles = status.summary.changedFiles;
  const changeLabel = changedFiles === 0
    ? "No changes"
    : `${changedFiles} ${changedFiles === 1 ? "change" : "changes"}`;
  const stagingParts = [
    stagedFiles > 0 ? `${stagedFiles} staged` : null,
    unstagedFiles > 0 ? `${unstagedFiles} unstaged` : null,
  ].filter((part): part is string => part !== null);
  const syncParts = [
    status.ahead > 0 ? `${status.ahead} ahead` : null,
    status.behind > 0 ? `${status.behind} behind` : null,
  ].filter((part): part is string => part !== null);

  return {
    branchName: status.currentBranch?.trim() || null,
    changedFiles,
    stagedFiles,
    unstagedFiles,
    conflictedFiles: status.summary.conflictedFiles,
    ahead: status.ahead,
    behind: status.behind,
    changeLabel,
    stagingLabel: stagingParts.join(" · ") || null,
    syncLabel: syncParts.join(" · ") || null,
    pullRequestLabel: pullRequestLabel(pullRequest),
    pushLabel: status.actions.pushLabel?.trim() || "Publish",
  };
}

function buildSummaryFacts({
  git,
  pullRequest,
}: {
  git: ComposerWorkspaceActivityModel["git"];
  pullRequest: WorkspaceActivityPullRequest | null;
}): WorkspaceActivityFact[] {
  const facts: WorkspaceActivityFact[] = [];
  if (git && git.conflictedFiles > 0) {
    facts.push({
      key: "conflicts",
      label: `${git.conflictedFiles} ${git.conflictedFiles === 1 ? "conflict" : "conflicts"}`,
      tone: "destructive",
    });
  }
  if (pullRequest?.checks === "failing") {
    facts.push({
      key: "pr-checks-failing",
      label: `${pullRequestPrefix(pullRequest)} checks failing`,
      tone: "destructive",
    });
  } else if (pullRequest?.reviewDecision === "changes_requested") {
    facts.push({
      key: "pr-changes-requested",
      label: `${pullRequestPrefix(pullRequest)} changes requested`,
      tone: "attention",
    });
  }
  if (git?.syncLabel) {
    facts.push({ key: "sync", label: git.syncLabel, tone: "default" });
  }
  if (git && git.changedFiles > 0) {
    facts.push({ key: "changes", label: git.changeLabel, tone: "default" });
  }
  if (
    pullRequest
    && pullRequest.checks !== "failing"
    && pullRequest.reviewDecision !== "changes_requested"
    && pullRequest.state !== "none"
  ) {
    const suffix = pullRequest.state === "merged"
      ? "merged"
      : pullRequest.state === "closed"
        ? "closed"
        : pullRequest.checks === "passing"
          ? "passing"
          : pullRequest.checks === "pending"
            ? "checks pending"
            : pullRequest.state === "draft"
              ? "draft"
              : "open";
    facts.push({
      key: "pull-request",
      label: `${pullRequestPrefix(pullRequest)} ${suffix}`,
      tone: "default",
    });
  }

  if (facts.length === 0 && git) {
    if (git.branchName) {
      facts.push({ key: "branch", label: git.branchName, tone: "default" });
    }
    facts.push({ key: "clean", label: "No changes", tone: "default" });
  }
  return facts;
}

function pullRequestLabel(pullRequest: WorkspaceActivityPullRequest | null): string | null {
  if (!pullRequest || pullRequest.state === "none") {
    return null;
  }
  const parts = [pullRequestPrefix(pullRequest)];
  if (pullRequest.state === "draft") parts.push("Draft");
  if (pullRequest.state === "open") parts.push("Open");
  if (pullRequest.state === "merged") parts.push("Merged");
  if (pullRequest.state === "closed") parts.push("Closed");
  if (pullRequest.checks === "failing") parts.push("Checks failing");
  if (pullRequest.checks === "pending") parts.push("Checks pending");
  if (pullRequest.checks === "passing") parts.push("Checks passing");
  if (pullRequest.reviewDecision === "changes_requested") parts.push("Changes requested");
  if (pullRequest.reviewDecision === "approved") parts.push("Approved");
  return parts.join(" · ");
}

function pullRequestPrefix(pullRequest: WorkspaceActivityPullRequest): string {
  return pullRequest.number === null ? "PR" : `PR #${pullRequest.number}`;
}
