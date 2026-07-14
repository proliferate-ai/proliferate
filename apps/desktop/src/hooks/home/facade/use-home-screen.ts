import { useCallback, useEffect, useMemo, useState } from "react";
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
import { useProductStorageContext } from "@/hooks/persistence/use-product-storage-context";
import {
  readPersistedStringValue,
  writePersistedString,
} from "@/lib/infra/persistence/product-storage";

const HOME_MODEL_PROBE_DISMISSED_STORAGE_KEY =
  "proliferate.home.modelProbeCardDismissed";

// Owns the Home screen facade consumed by the component. Does not own Home Next launch flow.
export function useHomeScreen() {
  const navigate = useNavigate();
  const storage = useProductStorageContext();
  const { isAddingRepo } = useAddRepo();
  const openAddRepoFlow = useAddRepoFlowStore((state) => state.openFlow);
  const {
    readyAgents,
    isLoading: agentsLoading,
    isReconciling,
  } = useAgentCatalog();
  const [modelProbeDismissed, setModelProbeDismissed] = useState<boolean>(false);
  useEffect(() => {
    let cancelled = false;
    // Bare "1" sentinel string (never JSON): read raw to preserve the existing
    // dismissal with zero migration. A late read after unmount is discarded.
    void readPersistedStringValue(storage, HOME_MODEL_PROBE_DISMISSED_STORAGE_KEY).then(
      (value) => {
        if (!cancelled && value === "1") {
          setModelProbeDismissed(true);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [storage]);
  const dismissModelProbeCard = useCallback(() => {
    setModelProbeDismissed(true);
    void writePersistedString(storage, HOME_MODEL_PROBE_DISMISSED_STORAGE_KEY, "1");
  }, [storage]);
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
        navigate(buildSettingsHref({ section: "agent-claude" }));
        return;
      case "agent-settings":
        navigate(buildSettingsHref({ section: "agent-claude" }));
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
