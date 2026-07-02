import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useRepositories } from "@proliferate/cloud-sdk-react";
import { useAgentCatalog } from "@/hooks/agents/derived/use-agent-catalog";
import { useCloudAvailabilityState } from "@/hooks/cloud/derived/use-cloud-availability-state";
import { useAddRepo } from "@/hooks/workspaces/workflows/use-add-repo";
import { useAddRepoFlowStore } from "@/stores/ui/add-repo-flow-store";
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

const HOME_MODEL_PROBE_DISMISSED_STORAGE_KEY =
  "proliferate.home.modelProbeCardDismissed";

function readHomeModelProbeDismissed(): boolean {
  try {
    return window.localStorage.getItem(HOME_MODEL_PROBE_DISMISSED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

// Owns the Home screen facade consumed by the component. Does not own Home Next launch flow.
export function useHomeScreen() {
  const navigate = useNavigate();
  const { isAddingRepo } = useAddRepo();
  const openAddRepoFlow = useAddRepoFlowStore((state) => state.openFlow);
  const {
    readyAgents,
    isLoading: agentsLoading,
    isReconciling,
  } = useAgentCatalog();
  const [modelProbeDismissed, setModelProbeDismissed] = useState<boolean>(() =>
    readHomeModelProbeDismissed()
  );
  const dismissModelProbeCard = useCallback(() => {
    setModelProbeDismissed(true);
    try {
      window.localStorage.setItem(HOME_MODEL_PROBE_DISMISSED_STORAGE_KEY, "1");
    } catch {
      // Persistence is best-effort; in-memory dismissal still applies.
    }
  }, []);
  const { cloudActive } = useCloudAvailabilityState();
  const {
    data: repoConfigs,
    isPending: repoConfigsPending,
  } = useRepositories(cloudActive);
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
      repoConfigs?.repositories ?? [],
    );
  }, [hiddenRepoRootIds, localWorkspaces, repoConfigs?.repositories, repoRoots]);
  const cloudRepoConfigsLoading =
    cloudActive && repoConfigsPending && !repoConfigs;
  const onboardingCards = useMemo(
    () => buildHomeOnboardingCards({
      repositories,
      repositoriesLoading,
      readyAgentCount: readyAgents.length,
      agentsLoading,
      defaultChatAgentKind,
      repoConfigs: repoConfigs?.repositories,
      cloudRepoConfigsLoading,
    }),
    [
      agentsLoading,
      cloudRepoConfigsLoading,
      defaultChatAgentKind,
      repositories,
      repoConfigs?.repositories,
      repositoriesLoading,
      readyAgents.length,
    ],
  );
  const repositoryToConfigure = useMemo(
    () => findHomeUnconfiguredGitHubRepository({
      repositories,
      repoConfigs: repoConfigs?.repositories,
    }),
    [repoConfigs?.repositories, repositories],
  );
  function handleHomeAction(actionId: HomeActionId) {
    switch (actionId) {
      case "add-repository":
        openAddRepoFlow();
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

  const readyHarnessKinds = useMemo(
    () => readyAgents.map((agent) => agent.kind),
    [readyAgents],
  );

  return {
    onboardingCards,
    isAddingRepo,
    handleHomeAction,
    // Model-probe card inputs (UX spec §10). The model count itself lives with
    // the home model-selection state, so the screen combines these with its
    // model groups via resolveHomeModelProbeCardState.
    modelProbeInputs: {
      dismissed: modelProbeDismissed,
      agentsLoading,
      isReconciling,
      harnessKinds: readyHarnessKinds,
    },
    dismissModelProbeCard,
  };
}
