import type { GitStatusSnapshot } from "@anyharness/sdk";
import type { PublishPullRequestDraft } from "#product/lib/domain/workspaces/creation/publish-workflow-model";

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
