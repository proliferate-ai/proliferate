import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CreatePullRequestResponse } from "@anyharness/sdk";
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
} from "@/lib/domain/workspaces/creation/publish-workflow";
import { defaultPublishPullRequestDraft } from "@/lib/domain/workspaces/creation/publish-draft";
import type {
  PublishCommitDraft,
  PublishIntent,
  PublishPullRequestDraft,
} from "@/lib/domain/workspaces/creation/publish-workflow-model";
import { persistedSnapshotFromPullRequestSummary } from "@/lib/domain/workspaces/git-status/workspace-git-status-snapshots";
import { runWorkspacePublishWorkflow } from "@/lib/workflows/workspaces/run-workspace-publish-workflow";
import { useRefreshPrStatuses } from "@/hooks/workspaces/cache/use-pr-status-refresh";
import { useLogicalWorkspaces } from "@/hooks/workspaces/derived/use-logical-workspaces";
import {
  recordWorkspaceGitStatusSnapshot,
  useWorkspaceUiStore,
} from "@/stores/preferences/workspace-ui-store";

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
  // Owns publish-dialog draft state plus submit wiring. The ordered Git
  // operation runner is plain workflow code under lib/workflows.
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
  const [isExecuting, setIsExecuting] = useState(false);
  const draftWorkspaceIdRef = useRef<string | null>(workspaceId);
  const executingRef = useRef(false);
  const runtimeReadyRef = useRef(runtimeBlockedReason === null);
  const { logicalWorkspaces } = useLogicalWorkspaces();
  const refreshPrStatuses = useRefreshPrStatuses();

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

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const resetDrafts = useCallback(() => {
    setCommitDraft({ summary: "", includeUnstaged: false });
    setPullRequestDraft({
      title: "",
      body: "",
      baseBranch: "",
      draft: false,
    });
    clearError();
  }, [clearError]);

  useEffect(() => {
    if (workspaceId && draftWorkspaceIdRef.current !== workspaceId) {
      draftWorkspaceIdRef.current = workspaceId;
      resetDrafts();
    }
  }, [resetDrafts, workspaceId]);

  useEffect(() => {
    const runtimeReady = runtimeBlockedReason === null;
    if (runtimeReadyRef.current && !runtimeReady) {
      resetDrafts();
    }
    runtimeReadyRef.current = runtimeReady;
  }, [resetDrafts, runtimeBlockedReason]);

  const submit = useCallback(async () => {
    if (executingRef.current) {
      return false;
    }
    if (viewState.disabledReason) {
      setError(viewState.disabledReason);
      return false;
    }
    executingRef.current = true;
    setIsExecuting(true);
    setError(null);
    let didComplete = false;
    try {
      let createdPullRequest: CreatePullRequestResponse["pullRequest"] | null = null;
      await runWorkspacePublishWorkflow(viewState.workflowSteps, {
        stagePaths: (paths) => stageMutation.mutateAsync(paths),
        commit: (input) => commitMutation.mutateAsync(input),
        push: () => pushMutation.mutateAsync({}),
        createPullRequest: async (input) => {
          const response = await createPullRequestMutation.mutateAsync(input);
          createdPullRequest = response.pullRequest;
          return response;
        },
      });
      if (workspaceId && createdPullRequest) {
        // The daemon already upserted its PR cache on create; persist the
        // created PR's identity so publish never flaps, then refresh.
        const logicalWorkspace = logicalWorkspaces.find((entry) =>
          entry.localWorkspace?.id === workspaceId
          || entry.aliasIds?.includes(workspaceId));
        if (logicalWorkspace) {
          const previous = useWorkspaceUiStore.getState()
            .gitStatusSnapshotByWorkspace[logicalWorkspace.id] ?? null;
          recordWorkspaceGitStatusSnapshot(
            logicalWorkspace.id,
            persistedSnapshotFromPullRequestSummary({
              summary: createdPullRequest,
              previous,
              capturedAt: new Date().toISOString(),
            }),
          );
          const repoRootId = logicalWorkspace.repoRoot?.id
            ?? logicalWorkspace.localWorkspace?.repoRootId;
          if (repoRootId?.trim()) {
            refreshPrStatuses(repoRootId.trim());
          }
        }
      }
      didComplete = true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      await Promise.allSettled([
        gitStatusQuery.refetch(),
        currentPullRequestEnabled
          ? currentPrQuery.refetch()
          : Promise.resolve(),
      ]);
      executingRef.current = false;
      setIsExecuting(false);
    }
    if (didComplete) {
      resetDrafts();
      return true;
    }
    return false;
  }, [
    commitMutation,
    createPullRequestMutation,
    currentPrQuery,
    currentPullRequestEnabled,
    gitStatusQuery,
    logicalWorkspaces,
    pushMutation,
    refreshPrStatuses,
    resetDrafts,
    stageMutation,
    viewState.disabledReason,
    viewState.workflowSteps,
    workspaceId,
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
    submit,
    clearError,
    resetDrafts,
    isLoading:
      gitStatusQuery.isLoading
      || (initialIntent === "pull_request" && currentPrQuery.isLoading),
    isSubmitting:
      isExecuting
      || stageMutation.isPending
      || commitMutation.isPending
      || pushMutation.isPending
      || createPullRequestMutation.isPending,
  };
}
