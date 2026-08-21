import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useRepositories } from "@proliferate/cloud-sdk-react";
import { useAgentCatalog } from "#product/hooks/agents/derived/use-agent-catalog";
import { useAuthSetupOnboardingStep } from "#product/hooks/agents/lifecycle/use-auth-setup-onboarding-step";
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

  // Ack-gated onboarding "setting up" step (agent-auth.md, Proof C7). The timer
  // step and the evidence-bound card are mutually exclusive on the
  // agentAuthEvidencePanes flag: exactly one is ever live, the other dormant.
  const authSetupStep = useAuthSetupOnboardingStep();
  const authSetupEvidence = useAuthSetupOnboardingEvidence();

  return {
    onboardingCards,
    authSetupStep,
    authSetupEvidence,
    isAddingRepo,
    handleHomeAction,
  };
}
