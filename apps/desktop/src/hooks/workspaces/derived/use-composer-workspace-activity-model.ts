import { useMemo } from "react";
import { useCurrentPullRequestQuery, useGitStatusQuery } from "@anyharness/sdk-react";
import { useWorkspaceGitStatuses } from "@/hooks/workspaces/derived/use-workspace-git-statuses";
import { useWorkspaceRuntimeBlock } from "@/hooks/workspaces/derived/use-workspace-runtime-block";
import {
  buildComposerWorkspaceActivityModel,
  type WorkspaceActivityPullRequest,
} from "@/lib/domain/workspaces/activity/composer-workspace-activity";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";

export function useComposerWorkspaceActivityModel() {
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const selectedLogicalWorkspaceId = useSessionSelectionStore(
    (state) => state.selectedLogicalWorkspaceId,
  );
  const { getWorkspaceRuntimeBlockReason } = useWorkspaceRuntimeBlock();
  const runtimeBlockedReason = getWorkspaceRuntimeBlockReason(selectedWorkspaceId);
  const gitStatusQuery = useGitStatusQuery({
    workspaceId: selectedWorkspaceId,
    enabled: !!selectedWorkspaceId && runtimeBlockedReason === null,
  });
  const currentBranch = gitStatusQuery.data?.currentBranch?.trim() || null;
  const currentPullRequestQuery = useCurrentPullRequestQuery({
    workspaceId: selectedWorkspaceId,
    enabled: !!selectedWorkspaceId && runtimeBlockedReason === null && !!currentBranch,
  });
  const { statusesByLogicalId } = useWorkspaceGitStatuses();
  const composedGitStatus = statusesByLogicalId[
    selectedLogicalWorkspaceId ?? selectedWorkspaceId ?? ""
  ] ?? null;

  const pullRequest = useMemo<WorkspaceActivityPullRequest | null>(() => {
    const currentPr = currentPullRequestQuery.data?.pullRequest;
    if (!currentPr) {
      return null;
    }
    // The direct workspace query owns PR identity/state and the action target.
    // The branch feed may enrich that PR with live checks/review data, but a
    // persisted snapshot must never override the current action target.
    const composedPr = composedGitStatus?.source === "live"
      && composedGitStatus.pr?.state !== "none"
      && composedGitStatus.pr?.number === currentPr.number
      ? composedGitStatus.pr
      : null;
    return {
      number: currentPr.number,
      state: currentPr.state === "open"
        ? currentPr.draft ? "draft" : "open"
        : currentPr.state,
      checks: composedPr?.checks ?? "none",
      reviewDecision: composedPr?.reviewDecision ?? "none",
    };
  }, [composedGitStatus, currentPullRequestQuery.data?.pullRequest]);

  const model = useMemo(() => buildComposerWorkspaceActivityModel({
    gitStatus: gitStatusQuery.data ?? null,
    pullRequest,
  }), [gitStatusQuery.data, pullRequest]);

  return {
    model,
    runtimeBlockedReason,
    hasExistingPullRequest: currentPullRequestQuery.data?.pullRequest != null,
  };
}
