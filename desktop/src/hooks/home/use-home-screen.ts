import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAgentCatalog } from "@/hooks/agents/use-agent-catalog";
import { useAddRepo } from "@/hooks/workspaces/use-add-repo";
import { useLogicalWorkspaces } from "@/hooks/workspaces/use-logical-workspaces";
import { useStandardRepoProjection } from "@/hooks/workspaces/use-standard-repo-projection";
import { useWorkspaceSelection } from "@/hooks/workspaces/selection/use-workspace-selection";
import {
  type HomeActionId,
  buildHomeActionCards,
} from "@/lib/domain/home/home-screen";
import { compareLogicalWorkspaceRecency } from "@/lib/domain/workspaces/sidebar/recency";
import { buildSettingsRepositoryEntries } from "@/lib/domain/settings/repositories";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";

export function useHomeScreen() {
  const navigate = useNavigate();
  const { addRepoFromPicker, isAddingRepo } = useAddRepo();
  const {
    readyAgents,
    isLoading: agentsLoading,
  } = useAgentCatalog();
  const { logicalWorkspaces } = useLogicalWorkspaces();
  const { localWorkspaces, repoRoots } = useStandardRepoProjection();
  const workspaceLastInteracted = useWorkspaceUiStore((s) => s.workspaceLastInteracted);
  const archivedWorkspaceIds = useWorkspaceUiStore((s) => s.archivedWorkspaceIds);
  const hiddenRepoRootIds = useWorkspaceUiStore((s) => s.hiddenRepoRootIds);
  const { selectWorkspace } = useWorkspaceSelection();

  const recentLogicalWorkspaces = useMemo(() => {
    const archivedSet = new Set(archivedWorkspaceIds);
    const hiddenRepoRootIdSet = new Set(hiddenRepoRootIds);
    return [...logicalWorkspaces]
      .filter((workspace) =>
        !archivedSet.has(workspace.id)
        && !(
          workspace.repoRoot?.id && hiddenRepoRootIdSet.has(workspace.repoRoot.id)
        )
        && !(
          workspace.localWorkspace?.repoRootId
          && hiddenRepoRootIdSet.has(workspace.localWorkspace.repoRootId)
        )
      )
      .sort((a, b) => compareLogicalWorkspaceRecency(a, b, workspaceLastInteracted))
      .slice(0, 4);
  }, [archivedWorkspaceIds, hiddenRepoRootIds, logicalWorkspaces, workspaceLastInteracted]);

  const repositories = useMemo(() => {
    const hiddenRepoRootIdSet = new Set(hiddenRepoRootIds);
    return buildSettingsRepositoryEntries(
      localWorkspaces.filter((workspace) =>
        workspace.repoRootId ? !hiddenRepoRootIdSet.has(workspace.repoRootId) : true
      ),
      repoRoots.filter((repoRoot) => !hiddenRepoRootIdSet.has(repoRoot.id)),
    );
  }, [hiddenRepoRootIds, localWorkspaces, repoRoots]);
  const latestLogicalWorkspace = recentLogicalWorkspaces[0] ?? null;
  const latestWorkspace = latestLogicalWorkspace?.localWorkspace ?? null;
  const actionCards = useMemo(
    () => buildHomeActionCards({
      latestWorkspace,
      readyAgentCount: readyAgents.length,
      agentsLoading,
    }),
    [agentsLoading, latestWorkspace, readyAgents.length],
  );
  function handleHomeAction(actionId: HomeActionId) {
    switch (actionId) {
      case "resume-last-workspace":
        if (latestLogicalWorkspace) {
          void selectWorkspace(latestLogicalWorkspace.id);
          return;
        }
        void addRepoFromPicker();
        return;
      case "add-repository":
        void addRepoFromPicker();
        return;
      case "agent-settings":
        navigate("/settings?section=agents");
        return;
      case "repository-settings": {
        const firstRepository = repositories[0];
        if (firstRepository) {
          navigate(`/settings?section=repo&repo=${encodeURIComponent(firstRepository.sourceRoot)}`);
          return;
        }
        navigate("/settings?section=general");
      }
    }
  }

  return {
    actionCards,
    isAddingRepo,
    handleHomeAction,
  };
}
