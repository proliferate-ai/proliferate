import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAgentCatalog } from "@/hooks/agents/use-agent-catalog";
import { useAddRepo } from "@/hooks/workspaces/use-add-repo";
import { useWorkspaces } from "@/hooks/workspaces/use-workspaces";
import { useWorkspaceSelection } from "@/hooks/workspaces/selection/use-workspace-selection";
import {
  type HomeActionId,
  buildHomeActionCards,
  buildHomeStatusMessage,
} from "@/lib/domain/home/home-screen";
import { buildSettingsRepositoryEntries } from "@/lib/domain/settings/repositories";
import { isUsableWorkspace } from "@/lib/domain/workspaces/usability";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";

const EMPTY_WORKSPACES: NonNullable<ReturnType<typeof useWorkspaces>["data"]>["workspaces"] = [];
const EMPTY_LOCAL_WORKSPACES: NonNullable<ReturnType<typeof useWorkspaces>["data"]>["localWorkspaces"] = [];
const EMPTY_REPO_ROOTS: NonNullable<ReturnType<typeof useWorkspaces>["data"]>["repoRoots"] = [];

export function useHomeScreen() {
  const navigate = useNavigate();
  const { addRepoFromPicker, isAddingRepo } = useAddRepo();
  const {
    readyAgents,
    agentsNeedingSetup,
    isReconciling,
    isLoading: agentsLoading,
  } = useAgentCatalog();
  const { data: workspaceCollections } = useWorkspaces();
  const workspaceLastInteracted = useWorkspaceUiStore((s) => s.workspaceLastInteracted);
  const archivedWorkspaceIds = useWorkspaceUiStore((s) => s.archivedWorkspaceIds);
  const { selectWorkspace } = useWorkspaceSelection();

  const workspaces = workspaceCollections?.workspaces ?? EMPTY_WORKSPACES;
  const localWorkspaces = workspaceCollections?.localWorkspaces ?? EMPTY_LOCAL_WORKSPACES;
  const repoRoots = workspaceCollections?.repoRoots ?? EMPTY_REPO_ROOTS;

  const recentWorkspaces = useMemo(() => {
    const archivedSet = new Set(archivedWorkspaceIds);
    return [...workspaces]
      .filter((workspace) => !archivedSet.has(workspace.id) && isUsableWorkspace(workspace))
      .sort((a, b) => {
        const aTime = new Date(workspaceLastInteracted[a.id] ?? a.updatedAt).getTime();
        const bTime = new Date(workspaceLastInteracted[b.id] ?? b.updatedAt).getTime();
        return bTime - aTime;
      })
      .slice(0, 4);
  }, [archivedWorkspaceIds, workspaceLastInteracted, workspaces]);

  const repositories = useMemo(
    () => buildSettingsRepositoryEntries(localWorkspaces, repoRoots),
    [localWorkspaces, repoRoots],
  );
  const latestWorkspace = recentWorkspaces[0] ?? null;
  const actionCards = useMemo(
    () => buildHomeActionCards({
      latestWorkspace,
      readyAgentCount: readyAgents.length,
      agentsLoading,
    }),
    [agentsLoading, latestWorkspace, readyAgents.length],
  );
  const statusMessage = useMemo(
    () => buildHomeStatusMessage({
      readyAgentNames: readyAgents.map((agent) => agent.displayName),
      agentsNeedingSetupNames: agentsNeedingSetup.map((agent) => agent.displayName),
      agentsLoading,
      isReconcilingAgents: isReconciling,
    }),
    [agentsLoading, agentsNeedingSetup, isReconciling, readyAgents],
  );

  function handleHomeAction(actionId: HomeActionId) {
    switch (actionId) {
      case "resume-last-workspace":
        if (latestWorkspace) {
          void selectWorkspace(latestWorkspace.id);
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
        navigate("/settings?section=configuration");
      }
    }
  }

  return {
    agentsLoading,
    actionCards,
    statusMessage,
    isAddingRepo,
    handleHomeAction,
  };
}
