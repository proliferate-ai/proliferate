import { useCallback, useMemo, useState } from "react";
import {
  useCommitGitMutation,
  useCreatePullRequestMutation,
  useCurrentPullRequestQuery,
  useGitStatusQuery,
  usePushGitMutation,
  useStageGitPathsMutation,
} from "@anyharness/sdk-react";
import {
  buildPublishViewState,
  defaultPublishPullRequestDraft,
  type PublishCommitDraft,
  type PublishIntent,
  type PublishPullRequestDraft,
} from "@/lib/domain/workspaces/publish-workflow";
import { runWorkspacePublishWorkflow } from "./run-workspace-publish-workflow";

export interface UseWorkspacePublishWorkflowOptions {
  workspaceId: string | null;
  initialIntent: PublishIntent;
  runtimeBlockedReason: string | null;
  repoDefaultBranch: string | null;
  enabled: boolean;
}

export function useWorkspacePublishWorkflow({
  workspaceId,
  initialIntent,
  runtimeBlockedReason,
  repoDefaultBranch,
  enabled,
}: UseWorkspacePublishWorkflowOptions) {
  const [commitDraft, setCommitDraft] = useState<PublishCommitDraft>({
    summary: "",
    includeUnstaged: false,
  });
  const [pullRequestDraft, setPullRequestDraft] = useState<PublishPullRequestDraft>({
    title: "",
    body: "",
    baseBranch: "",
    draft: false,
  });
  const [error, setError] = useState<string | null>(null);

  const gitStatusQuery = useGitStatusQuery({ workspaceId, enabled });
  const currentPullRequestEnabled = enabled && Boolean(gitStatusQuery.data?.currentBranch?.trim());
  const currentPrQuery = useCurrentPullRequestQuery({
    workspaceId,
    enabled: currentPullRequestEnabled,
  });
  const stageMutation = useStageGitPathsMutation({ workspaceId });
  const commitMutation = useCommitGitMutation({ workspaceId });
  const pushMutation = usePushGitMutation({ workspaceId });
  const createPullRequestMutation = useCreatePullRequestMutation({ workspaceId });

  const defaultPrDraft = useMemo(
    () => defaultPublishPullRequestDraft({
      gitStatus: gitStatusQuery.data,
      repoDefaultBranch,
    }),
    [gitStatusQuery.data, repoDefaultBranch],
  );

  const viewState = useMemo(
    () => buildPublishViewState({
      gitStatus: gitStatusQuery.data,
      existingPr: currentPrQuery.data?.pullRequest ?? null,
      runtimeBlockedReason,
      repoDefaultBranch,
      initialIntent,
      commitDraft,
      pullRequestDraft: {
        ...pullRequestDraft,
        baseBranch: pullRequestDraft.baseBranch.trim() || defaultPrDraft.baseBranch,
      },
    }),
    [
      commitDraft,
      currentPrQuery.data?.pullRequest,
      defaultPrDraft.baseBranch,
      gitStatusQuery.data,
      initialIntent,
      pullRequestDraft,
      repoDefaultBranch,
      runtimeBlockedReason,
    ],
  );

  const resetDrafts = useCallback(() => {
    setCommitDraft({ summary: "", includeUnstaged: false });
    setPullRequestDraft({
      title: "",
      body: "",
      baseBranch: "",
      draft: false,
    });
    setError(null);
  }, []);

  const submit = useCallback(async () => {
    if (viewState.disabledReason) {
      setError(viewState.disabledReason);
      return false;
    }
    setError(null);
    try {
      await runWorkspacePublishWorkflow(viewState.workflowSteps, {
        stagePaths: (paths) => stageMutation.mutateAsync(paths),
        commit: (input) => commitMutation.mutateAsync(input),
        push: () => pushMutation.mutateAsync({}),
        createPullRequest: (input) => createPullRequestMutation.mutateAsync(input),
      });
      await Promise.all([
        gitStatusQuery.refetch(),
        currentPullRequestEnabled
          ? currentPrQuery.refetch()
          : Promise.resolve(),
      ]);
      resetDrafts();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      return false;
    }
  }, [
    commitMutation,
    createPullRequestMutation,
    currentPrQuery,
    currentPullRequestEnabled,
    gitStatusQuery,
    pushMutation,
    resetDrafts,
    stageMutation,
    viewState.disabledReason,
    viewState.workflowSteps,
  ]);

  return {
    commitDraft,
    setCommitDraft,
    pullRequestDraft: {
      ...pullRequestDraft,
      baseBranch: pullRequestDraft.baseBranch.trim() || viewState.defaultBaseBranch,
    },
    setPullRequestDraft,
    viewState,
    error,
    resetDrafts,
    submit,
    isLoading: gitStatusQuery.isLoading,
    isSubmitting:
      stageMutation.isPending
      || commitMutation.isPending
      || pushMutation.isPending
      || createPullRequestMutation.isPending,
  };
}
