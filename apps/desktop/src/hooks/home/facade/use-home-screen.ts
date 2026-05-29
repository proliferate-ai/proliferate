import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAgentCatalog } from "@/hooks/agents/derived/use-agent-catalog";
import { useCloudRepoConfigs } from "@/hooks/access/cloud/use-cloud-repo-configs";
import { useCloudAvailabilityState } from "@/hooks/cloud/derived/use-cloud-availability-state";
import { useAddRepo } from "@/hooks/workspaces/workflows/use-add-repo";
import { useStandardRepoProjection } from "@/hooks/workspaces/derived/use-standard-repo-projection";
import {
  type HomeActionId,
  buildHomeOnboardingCards,
  findHomeUnconfiguredGitHubRepository,
} from "@/lib/domain/home/home-screen";
import { buildSettingsRepositoryEntries } from "@/lib/domain/settings/repositories";
import {
  buildCloudRepoSettingsHref,
  buildSettingsHref,
} from "@/lib/domain/settings/navigation";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";

// Owns the Home screen facade consumed by the component. Does not own Home Next launch flow.
export function useHomeScreen() {
  const navigate = useNavigate();
  const { addRepoFromPicker, isAddingRepo } = useAddRepo();
  const {
    readyAgents,
    isLoading: agentsLoading,
  } = useAgentCatalog();
  const { cloudActive } = useCloudAvailabilityState();
  const {
    data: cloudRepoConfigs,
    isPending: cloudRepoConfigsPending,
  } = useCloudRepoConfigs(cloudActive);
  const {
    localWorkspaces,
    repoRoots,
    isLoading: repositoriesLoading,
  } = useStandardRepoProjection();
  const defaultChatAgentKind =
    useUserPreferencesStore((state) => state.defaultChatAgentKind);
  const hiddenRepoRootIds = useWorkspaceUiStore((s) => s.hiddenRepoRootIds);

  const repositories = useMemo(() => {
    const hiddenRepoRootIdSet = new Set(hiddenRepoRootIds);
    return buildSettingsRepositoryEntries(
      localWorkspaces.filter((workspace) =>
        workspace.repoRootId ? !hiddenRepoRootIdSet.has(workspace.repoRootId) : true
      ),
      repoRoots.filter((repoRoot) => !hiddenRepoRootIdSet.has(repoRoot.id)),
    );
  }, [hiddenRepoRootIds, localWorkspaces, repoRoots]);
  const cloudRepoConfigsLoading =
    cloudActive && cloudRepoConfigsPending && !cloudRepoConfigs;
  const onboardingCards = useMemo(
    () => buildHomeOnboardingCards({
      repositories,
      repositoriesLoading,
      readyAgentCount: readyAgents.length,
      agentsLoading,
      defaultChatAgentKind,
      cloudRepoConfigs: cloudRepoConfigs?.configs,
      cloudRepoConfigsLoading,
    }),
    [
      agentsLoading,
      cloudRepoConfigs?.configs,
      cloudRepoConfigsLoading,
      defaultChatAgentKind,
      repositories,
      repositoriesLoading,
      readyAgents.length,
    ],
  );
  const repositoryToConfigure = useMemo(
    () => findHomeUnconfiguredGitHubRepository({
      repositories,
      cloudRepoConfigs: cloudRepoConfigs?.configs,
    }),
    [cloudRepoConfigs?.configs, repositories],
  );
  function handleHomeAction(actionId: HomeActionId) {
    switch (actionId) {
      case "add-repository":
        void addRepoFromPicker();
        return;
      case "agent-defaults":
        navigate("/settings?section=agent-defaults");
        return;
      case "agent-settings":
        navigate("/settings?section=agent-defaults");
        return;
      case "repository-settings": {
        const firstRepository = repositoryToConfigure ?? repositories[0];
        if (firstRepository?.gitOwner && firstRepository.gitRepoName) {
          navigate(buildCloudRepoSettingsHref(firstRepository.gitOwner, firstRepository.gitRepoName));
          return;
        }
        if (firstRepository?.sourceRoot) {
          navigate(buildSettingsHref({
            section: "environments",
            repo: firstRepository.sourceRoot,
          }));
          return;
        }
        navigate("/settings?section=environments");
      }
    }
  }

  return {
    onboardingCards,
    isAddingRepo,
    handleHomeAction,
  };
}
