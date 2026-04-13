import { useMemo } from "react";
import { useGitStatusQuery } from "@anyharness/sdk-react";
import {
  buildMobilityPromptState,
  type MobilityPromptState,
} from "@/lib/domain/workspaces/mobility-prompt";
import { useMobilityFooterContext } from "@/hooks/workspaces/mobility/use-mobility-footer-context";
import { useWorkspaceMobilityState } from "./use-workspace-mobility-state";

export function useMobilityPromptState(
  isPreparing: boolean,
  hasResolvedPrompt: boolean,
  isPromptActive: boolean,
): MobilityPromptState | null {
  const mobility = useWorkspaceMobilityState();
  const footerContext = useMobilityFooterContext();
  const shouldResolveGitSync = isPromptActive
    && mobility.canMoveToCloud
    && Boolean(mobility.localWorkspaceId);
  const gitStatusQuery = useGitStatusQuery({
    workspaceId: mobility.localWorkspaceId,
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

  return useMemo(() => {
    if (!footerContext) {
      return null;
    }

    return buildMobilityPromptState({
      isPreparing,
      hasResolvedPrompt,
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
    hasResolvedPrompt,
    isGitSyncResolved,
    isPreparing,
    mobility.canBringBackLocal,
    mobility.canMoveToCloud,
    mobility.confirmSnapshot,
    mobility.localWorkspaceId,
    mobility.repoBacked,
    mobility.selectedLogicalWorkspace?.repoRoot?.id,
    mobility.selectionLocked,
    mobility.status,
    shouldResolveGitSync,
  ]);
}
