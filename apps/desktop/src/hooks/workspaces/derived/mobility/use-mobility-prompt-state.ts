import { useMemo } from "react";
import { useGitStatusQuery } from "@anyharness/sdk-react";
import {
  buildMobilityPromptState,
  type MobilityPromptState,
} from "@/lib/domain/workspaces/mobility/mobility-prompt";
import { useMobilityFooterContext } from "@/hooks/workspaces/derived/mobility/use-mobility-footer-context";
import { useWorkspaceMobilityState } from "./use-workspace-mobility-state";

export function useMobilityPromptState(
  isPreparing: boolean,
  hasResolvedPrompt: boolean,
  isPromptActive: boolean,
  preparationError: string | null,
): MobilityPromptState | null {
  const mobility = useWorkspaceMobilityState();
  const footerContext = useMobilityFooterContext();
  const sourceWorkspaceId = mobility.confirmSnapshot?.sourceWorkspaceId
    ?? (mobility.canMoveToCloud
      ? mobility.localWorkspaceId
      : mobility.canBringBackLocal
        ? mobility.cloudMaterializationId
        : null);
  const shouldResolveGitSync = isPromptActive
    && Boolean(sourceWorkspaceId);
  const gitStatusQuery = useGitStatusQuery({
    workspaceId: sourceWorkspaceId,
    enabled: shouldResolveGitSync,
  });
  const gitSync = useMemo(() => {
    if (!gitStatusQuery.data) {
      return null;
    }

    return {
      upstreamBranch: gitStatusQuery.data.upstreamBranch ?? null,
      ahead: gitStatusQuery.data.ahead,
      behind: gitStatusQuery.data.behind,
      clean: gitStatusQuery.data.clean,
    };
  }, [gitStatusQuery.data]);
  const isGitSyncResolved = !shouldResolveGitSync
    || gitStatusQuery.status === "success"
    || gitStatusQuery.status === "error";
  const gitSyncError = shouldResolveGitSync && gitStatusQuery.status === "error"
    ? `Git status couldn't be loaded: ${errorMessage(gitStatusQuery.error)}`
    : null;

  return useMemo(() => {
    if (!footerContext) {
      return null;
    }

    return buildMobilityPromptState({
      isPreparing,
      hasResolvedPrompt,
      preparationError: preparationError ?? gitSyncError,
      locationKind: footerContext.locationKind,
      repoBacked: mobility.repoBacked,
      canMoveToCloud: mobility.canMoveToCloud,
      canBringBackLocal: mobility.canBringBackLocal,
      hasLocalRepoRoot: Boolean(mobility.selectedLogicalWorkspace?.repoRoot?.id),
      selectionLocked: mobility.selectionLocked,
      status: mobility.status,
      confirmSnapshot: mobility.confirmSnapshot,
      gitSync,
      isGitSyncResolved,
    });
  }, [
    footerContext,
    gitSync,
    gitSyncError,
    hasResolvedPrompt,
    isGitSyncResolved,
    isPreparing,
    preparationError,
    mobility.canBringBackLocal,
    mobility.canMoveToCloud,
    mobility.cloudMaterializationId,
    mobility.confirmSnapshot,
    mobility.localWorkspaceId,
    mobility.repoBacked,
    mobility.selectedLogicalWorkspace?.repoRoot?.id,
    mobility.selectionLocked,
    mobility.status,
    shouldResolveGitSync,
  ]);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Try again in a moment.";
}
