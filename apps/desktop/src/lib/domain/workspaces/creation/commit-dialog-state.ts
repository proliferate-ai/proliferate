/**
 * Pure state machine for the commit/push/PR dialog. Given git status inputs,
 * computes which actions are available and which dialog mode to display.
 * No React, no side effects — fully unit-testable.
 */
import type {
  CurrentPullRequestResponse,
  GitStatusSnapshot,
} from "@anyharness/sdk";
import type { PublishFileGroups } from "@/lib/domain/workspaces/creation/publish-workflow-model";
import { groupPublishFiles } from "@/lib/domain/workspaces/creation/publish-file-groups";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CommitDialogStep = "actions" | "pull_request";

export type CommitAction = "commit" | "commit_and_push" | "push" | "create_pr";

export interface CommitDialogGitState {
  gitStatus: GitStatusSnapshot | null | undefined;
  existingPr: NonNullable<CurrentPullRequestResponse["pullRequest"]> | null;
  runtimeBlockedReason: string | null;
}

export interface CommitDialogDerivedState {
  /** Current branch name (trimmed, null if detached/missing). */
  branchName: string | null;
  /** Computed file groups from git status. */
  fileGroups: PublishFileGroups;
  /** Tree has staged or unstaged changes. */
  hasDirtyTree: boolean;
  /** Has staged changes. */
  hasStagedChanges: boolean;
  /** Has unstaged changes. */
  hasUnstagedChanges: boolean;
  /** Has unpushed local commits. */
  hasUnpushedCommits: boolean;
  /** Branch is fully synced with remote. */
  isSynced: boolean;
  /** An existing PR is open for this branch. */
  existingPr: NonNullable<CurrentPullRequestResponse["pullRequest"]> | null;
  /** Total additions across all changed files. */
  totalAdditions: number;
  /** Total deletions across all changed files. */
  totalDeletions: number;
  /** Blocking reason (conflict, detached, runtime not ready). */
  blockingReason: string | null;
  /** Which actions are available given the current state. */
  availableActions: CommitAction[];
  /** Dialog mode to display (what is visible). */
  dialogMode: CommitDialogMode;
  /** Default base branch for PR creation. */
  defaultBaseBranch: string;
}

export type CommitDialogMode =
  | "dirty"           // has local changes — show commit textarea + all actions
  | "unpushed"        // clean tree, unpushed commits — show "no local changes" + Push/PR
  | "synced_no_pr"    // clean + synced + no PR — offer Create PR if branch != base
  | "synced_has_pr"   // clean + synced + PR exists — View PR
  | "blocked";        // detached/conflicted/runtime not ready

// ---------------------------------------------------------------------------
// AI generation config exposed by the dialog hook
// ---------------------------------------------------------------------------

export type GenerationStatus = "idle" | "generating" | "failed";

export interface CommitGenerationConfig {
  /** Whether AI generation is available (auth gated). */
  generationAvailable: boolean;
  /** Commit message generation status. */
  commitStatus: GenerationStatus;
  /** PR fields generation status. */
  prStatus: GenerationStatus;
  /** Trigger commit message generation. Resolves with the generated text or null. */
  generateCommitMessage?: () => Promise<string | null>;
  /** Trigger PR title+body generation. Resolves with fields or null. */
  generatePrFields?: () => Promise<{ title: string; body: string } | null>;
}

// ---------------------------------------------------------------------------
// Core state computation
// ---------------------------------------------------------------------------

export function deriveCommitDialogState(
  input: CommitDialogGitState,
  repoDefaultBranch: string | null,
): CommitDialogDerivedState {
  const gitStatus = input.gitStatus ?? null;
  const branchName = gitStatus?.currentBranch?.trim() || null;
  const fileGroups = groupPublishFiles(gitStatus?.files ?? []);
  const hasStagedChanges = fileGroups.staged.length > 0 || fileGroups.partial.length > 0;
  const hasUnstagedChanges = fileGroups.unstaged.length > 0 || fileGroups.partial.length > 0;
  const hasDirtyTree = hasStagedChanges || hasUnstagedChanges;
  const canPush = gitStatus?.actions.canPush ?? false;
  const hasUnpushedCommits = (gitStatus?.ahead ?? 0) > 0 || canPush;
  const isSynced = !hasDirtyTree && !hasUnpushedCommits;

  const defaultBaseBranch = gitStatus?.suggestedBaseBranch?.trim()
    || repoDefaultBranch?.trim()
    || "main";

  const allFiles = [
    ...fileGroups.staged,
    ...fileGroups.partial,
    ...fileGroups.unstaged,
  ];
  const totalAdditions = allFiles.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = allFiles.reduce((sum, f) => sum + f.deletions, 0);

  const blockingReason = resolveBlockingReason(input, gitStatus, branchName);

  const availableActions = resolveAvailableActions({
    blockingReason,
    hasDirtyTree,
    hasUnpushedCommits,
    isSynced,
    existingPr: input.existingPr,
    branchName,
    defaultBaseBranch,
    gitStatus,
  });

  const dialogMode = resolveDialogMode({
    blockingReason,
    hasDirtyTree,
    hasUnpushedCommits,
    isSynced,
    existingPr: input.existingPr,
  });

  return {
    branchName,
    fileGroups,
    hasDirtyTree,
    hasStagedChanges,
    hasUnstagedChanges,
    hasUnpushedCommits,
    isSynced,
    existingPr: input.existingPr,
    totalAdditions,
    totalDeletions,
    blockingReason,
    availableActions,
    dialogMode,
    defaultBaseBranch,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function resolveBlockingReason(
  input: CommitDialogGitState,
  gitStatus: GitStatusSnapshot | null,
  branchName: string | null,
): string | null {
  if (input.runtimeBlockedReason) return input.runtimeBlockedReason;
  if (!gitStatus) return "Git status is loading.";
  if (gitStatus.conflicted || gitStatus.actions.reasonIfBlocked) {
    return gitStatus.actions.reasonIfBlocked ?? "Resolve conflicts before committing.";
  }
  if (gitStatus.detached || !branchName) {
    return "Switch to a branch before committing.";
  }
  return null;
}

function resolveAvailableActions(input: {
  blockingReason: string | null;
  hasDirtyTree: boolean;
  hasUnpushedCommits: boolean;
  isSynced: boolean;
  existingPr: NonNullable<CurrentPullRequestResponse["pullRequest"]> | null;
  branchName: string | null;
  defaultBaseBranch: string;
  gitStatus: GitStatusSnapshot | null;
}): CommitAction[] {
  if (input.blockingReason) return [];

  const actions: CommitAction[] = [];

  if (input.hasDirtyTree) {
    actions.push("commit");
    actions.push("commit_and_push");
    actions.push("push");
    actions.push("create_pr");
    return actions;
  }

  if (input.hasUnpushedCommits) {
    actions.push("push");
    actions.push("create_pr");
    return actions;
  }

  // Synced — only Create PR if branch is different from base
  if (input.isSynced && !input.existingPr) {
    const branchMatchesBase = normalizeBranch(input.branchName) === normalizeBranch(input.defaultBaseBranch);
    if (!branchMatchesBase && input.gitStatus?.actions.canCreatePullRequest) {
      actions.push("create_pr");
    }
  }

  return actions;
}

function resolveDialogMode(input: {
  blockingReason: string | null;
  hasDirtyTree: boolean;
  hasUnpushedCommits: boolean;
  isSynced: boolean;
  existingPr: NonNullable<CurrentPullRequestResponse["pullRequest"]> | null;
}): CommitDialogMode {
  if (input.blockingReason) return "blocked";
  if (input.hasDirtyTree) return "dirty";
  if (input.hasUnpushedCommits) return "unpushed";
  if (input.existingPr) return "synced_has_pr";
  return "synced_no_pr";
}

function normalizeBranch(branch: string | null): string {
  return (branch ?? "")
    .trim()
    .replace(/^refs\/heads\//, "")
    .replace(/^heads\//, "");
}

// ---------------------------------------------------------------------------
// Validation for submit
// ---------------------------------------------------------------------------

export function validateCommitAction(input: {
  action: CommitAction;
  commitMessage: string;
  includeUnstaged: boolean;
  hasStagedChanges: boolean;
  hasUnstagedChanges: boolean;
  hasDirtyTree: boolean;
  /** When true, empty commit message is allowed (generation will fill it). */
  allowEmptyForGeneration?: boolean;
}): string | null {
  const needsCommit = input.action === "commit" || input.action === "commit_and_push";
  if (needsCommit && input.hasDirtyTree) {
    if (!input.includeUnstaged && !input.hasStagedChanges) {
      return "Stage changes or enable Include unstaged changes.";
    }
    if (!input.commitMessage.trim() && !input.allowEmptyForGeneration) {
      return "Enter a commit message.";
    }
  }
  return null;
}

export function validatePrCreation(input: {
  title: string;
  baseBranch: string;
  branchName: string | null;
}): string | null {
  if (!input.title.trim()) return "Enter a pull request title.";
  if (!input.baseBranch.trim()) return "Choose a base branch.";
  const headNorm = normalizeBranch(input.branchName);
  const baseNorm = normalizeBranch(input.baseBranch);
  if (headNorm.length > 0 && headNorm === baseNorm) {
    return `Switch to a branch other than ${input.baseBranch} before creating a PR.`;
  }
  return null;
}
