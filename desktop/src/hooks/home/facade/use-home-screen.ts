import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAgentCatalog } from "@/hooks/agents/derived/use-agent-catalog";
import { useAddRepo } from "@/hooks/workspaces/workflows/use-add-repo";
import { useLogicalWorkspaces } from "@/hooks/workspaces/derived/use-logical-workspaces";
import { useStandardRepoProjection } from "@/hooks/workspaces/derived/use-standard-repo-projection";
import { useWorkspaceSelection } from "@/hooks/workspaces/selection/use-workspace-selection";
import {
  type HomeActionId,
  buildHomeActionCards,
  buildHomeGitHubRepositoryOnboarding,
} from "@/lib/domain/home/home-screen";
import {
  expandLogicalWorkspaceRelatedIdSet,
  logicalWorkspaceRelatedIds,
} from "@/lib/domain/workspaces/cloud/logical-workspace-lookup";
import { compareLogicalWorkspaceRecency } from "@/lib/domain/workspaces/sidebar/recency";
import { buildSettingsRepositoryEntries } from "@/lib/domain/settings/repositories";
import { buildSettingsHref } from "@/lib/domain/settings/navigation";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";

// Owns the Home screen facade consumed by the component. Does not own Home Next launch flow.
export function useHomeScreen() {
  const navigate = useNavigate();
  const { addRepoFromPicker, isAddingRepo } = useAddRepo();
  const {
    readyAgents,
    isLoading: agentsLoading,
  } = useAgentCatalog();
  const { logicalWorkspaces } = useLogicalWorkspaces();
  const {
    localWorkspaces,
    repoRoots,
    isLoading: repositoriesLoading,
  } = useStandardRepoProjection();
  const workspaceLastInteracted = useWorkspaceUiStore((s) => s.workspaceLastInteracted);
  const archivedWorkspaceIds = useWorkspaceUiStore((s) => s.archivedWorkspaceIds);
  const hiddenRepoRootIds = useWorkspaceUiStore((s) => s.hiddenRepoRootIds);
  const { selectWorkspace } = useWorkspaceSelection();

  const recentLogicalWorkspaces = useMemo(() => {
    const archivedSet = expandLogicalWorkspaceRelatedIdSet(logicalWorkspaces, archivedWorkspaceIds);
    const hiddenRepoRootIdSet = new Set(hiddenRepoRootIds);
    return [...logicalWorkspaces]
      .filter((workspace) =>
        !logicalWorkspaceRelatedIds(workspace).some((id) => archivedSet.has(id))
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
  const githubRepositoryOnboarding = useMemo(
    () => buildHomeGitHubRepositoryOnboarding({
      repositories,
      repositoriesLoading,
    }),
    [repositories, repositoriesLoading],
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
          navigate(buildSettingsHref({
            section: "environments",
            repo: firstRepository.sourceRoot,
          }));
          return;
        }
        navigate("/settings?section=general");
      }
    }
  }

  return {
    actionCards,
    githubRepositoryOnboarding,
    isAddingRepo,
    handleHomeAction,
  };
}
