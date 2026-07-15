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
  summary: string;
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
