import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useRepositories } from "@proliferate/cloud-sdk-react";
import { useAgentCatalog } from "#product/hooks/agents/derived/use-agent-catalog";
import { useAuthSetupOnboardingEvidence } from "#product/hooks/agents/lifecycle/use-auth-setup-onboarding-evidence";
import { useCloudAvailabilityState } from "#product/hooks/cloud/derived/use-cloud-availability-state";
import { useAddRepo } from "#product/hooks/workspaces/workflows/use-add-repo";
import { useAddRepoFlowStore } from "#product/stores/ui/add-repo-flow-store";
import { useStandardRepoProjection } from "#product/hooks/workspaces/derived/use-standard-repo-projection";
import {
  type HomeActionId,
  buildHomeOnboardingCards,
  findHomeUnconfiguredGitHubRepository,
} from "#product/lib/domain/home/home-screen";
import { getSettingsSectionForHarnessKind } from "#product/lib/domain/settings/navigation-presentation";
import { buildSettingsRepositoryEntries } from "#product/lib/domain/settings/repositories";
import {
  buildCloudRepoSettingsHref,
  buildSettingsHref,
} from "#product/lib/domain/settings/navigation";
import { useUserPreferencesStore } from "#product/stores/preferences/user-preferences-store";
import { useWorkspaceUiStore } from "#product/stores/preferences/workspace-ui-store";

// Owns the Home screen facade consumed by the component. Does not own Home Next launch flow.
export function useHomeScreen() {
  const navigate = useNavigate();
  const { isAddingRepo } = useAddRepo();
  const openAddRepoFlow = useAddRepoFlowStore((state) => state.openFlow);
  // readyAgentCount below is used only for the "configure default
  // harnesses" onboarding card; the readiness card lives in its own hook
  // (useHomeInstallationReadiness), sourced from the live reconcile job
  // snapshot rather than this catalog (D-R1/D-R2).
  const {
    readyAgents,
    isLoading: agentsLoading,
  } = useAgentCatalog();
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
  function handleHomeAction(actionId: HomeActionId, options?: { harnessKind?: string | null }) {
    switch (actionId) {
      case "add-repository":
        openAddRepoFlow();
        return;
      case "agent-defaults":
        navigate(buildSettingsHref({ section: "agent-claude" }));
        return;
      case "agent-settings": {
        // Land on an agent the caller actually means. The terminal
        // "no agents are supported" notice is only honest if the pane it
        // opens shows an unsupported agent, not whatever Claude reports.
        const section = options?.harnessKind
          ? getSettingsSectionForHarnessKind(options.harnessKind)
          : null;
        navigate(buildSettingsHref({ section: section ?? "agent-claude" }));
        return;
      }
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

  // The one onboarding "setting up" card, state-bound to the runtime's status
  // documents (agent_auth §4 cell 4). There is no timer step and no flag.
  const authSetupEvidence = useAuthSetupOnboardingEvidence();

  return {
    onboardingCards,
    authSetupEvidence,
    isAddingRepo,
    handleHomeAction,
  };
}
