import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useCommitGitMutation,
  useGitStatusQuery,
  usePushGitMutation,
  useStageGitPathsMutation,
} from "@anyharness/sdk-react";
import {
  buildMobilityGitPrepViewState,
  defaultMobilityCommitMessage,
} from "@/lib/domain/workspaces/mobility/mobility-git-prep";
import type { WorkspaceMobilityDirection } from "@/lib/domain/workspaces/mobility/types";
import type { PublishCommitDraft } from "@/lib/domain/workspaces/creation/publish-workflow-model";
import { runWorkspacePublishWorkflow } from "@/lib/workflows/workspaces/run-workspace-publish-workflow";

export function useWorkspaceMobilityGitPrepWorkflow({
  workspaceId,
  direction,
  enabled,
}: {
  workspaceId: string | null;
  direction: WorkspaceMobilityDirection | null;
  enabled: boolean;
}) {
  const [commitDraft, setCommitDraft] = useState<PublishCommitDraft>(() => ({
    summary: defaultMobilityCommitMessage(direction),
    includeUnstaged: true,
  }));
  const [error, setError] = useState<string | null>(null);
  const draftKeyRef = useRef(`${workspaceId ?? ""}:${direction ?? ""}`);
  const gitStatusQuery = useGitStatusQuery({ workspaceId, enabled });
  const stageMutation = useStageGitPathsMutation({ workspaceId });
  const commitMutation = useCommitGitMutation({ workspaceId });
  const pushMutation = usePushGitMutation({ workspaceId });

  const resetDraft = useCallback(() => {
    setCommitDraft({
      summary: defaultMobilityCommitMessage(direction),
      includeUnstaged: true,
    });
    setError(null);
  }, [direction]);

  useEffect(() => {
    const draftKey = `${workspaceId ?? ""}:${direction ?? ""}`;
    if (draftKeyRef.current !== draftKey) {
      draftKeyRef.current = draftKey;
      resetDraft();
    }
  }, [direction, resetDraft, workspaceId]);

  const viewState = useMemo(() => buildMobilityGitPrepViewState({
    gitStatus: gitStatusQuery.data,
    runtimeBlockedReason: null,
    direction,
    commitDraft,
  }), [
    commitDraft,
    direction,
    gitStatusQuery.data,
  ]);

  const submit = useCallback(async () => {
    setError(null);
    try {
      const latestStatus = await gitStatusQuery.refetch();
      if (latestStatus.error) {
        throw latestStatus.error;
      }
      const latestViewState = buildMobilityGitPrepViewState({
        gitStatus: latestStatus.data,
        runtimeBlockedReason: null,
        direction,
        commitDraft,
      });
      if (latestViewState.disabledReason) {
        setError(latestViewState.disabledReason);
        return false;
      }
      await runWorkspacePublishWorkflow(latestViewState.workflowSteps, {
        stagePaths: (paths) => stageMutation.mutateAsync(paths),
        commit: (input) => commitMutation.mutateAsync(input),
        push: () => pushMutation.mutateAsync({}),
        createPullRequest: async () => undefined,
      });
      await gitStatusQuery.refetch();
      resetDraft();
      return true;
    } catch (caught) {
      setError(errorMessage(caught));
      return false;
    }
  }, [
    commitMutation,
    commitDraft,
    direction,
    gitStatusQuery,
    pushMutation,
    resetDraft,
    stageMutation,
  ]);

  return {
    commitDraft,
    setCommitDraft,
    error,
    viewState,
    submit,
    resetDraft,
    isLoading: gitStatusQuery.isLoading,
    isSubmitting: stageMutation.isPending || commitMutation.isPending || pushMutation.isPending,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
