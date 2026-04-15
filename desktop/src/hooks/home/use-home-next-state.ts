import { useMemo } from "react";
import type { GitBranchRef, ModelRegistry, RepoRoot, Workspace } from "@anyharness/sdk";
import {
  useModelRegistriesQuery,
  useRepoRootGitBranchesQuery,
} from "@anyharness/sdk-react";
import { useAgentCatalog } from "@/hooks/agents/use-agent-catalog";
import { useStandardRepoProjection } from "@/hooks/workspaces/use-standard-repo-projection";
import { useWorkspaceRuntimeBlock } from "@/hooks/workspaces/use-workspace-runtime-block";
import {
  buildHomeNextAgentOptions,
  findHomeNextMatchingWorkspace,
  localBranchNames,
  resolveHomeNextDefaultBranchName,
  resolveHomeNextRepositorySelection,
  resolveSelectedHomeNextAgentOption,
  type HomeNextLaunchTarget,
  type HomeNextRepositorySelection,
} from "@/lib/domain/home/home-next-launch";
import { buildSettingsRepositoryEntries } from "@/lib/domain/settings/repositories";
import { useRepoPreferencesStore } from "@/stores/preferences/repo-preferences-store";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";

const EMPTY_WORKSPACES: Workspace[] = [];
const EMPTY_REPO_ROOTS: RepoRoot[] = [];
const EMPTY_MODEL_REGISTRIES: ModelRegistry[] = [];
const EMPTY_BRANCH_REFS: GitBranchRef[] = [];

interface UseHomeNextStateArgs {
  selectedAgentKind: string | null;
  repositorySelection: HomeNextRepositorySelection;
  selectedBranch: string | null;
}

export function useHomeNextState({
  selectedAgentKind,
  repositorySelection,
  selectedBranch,
}: UseHomeNextStateArgs) {
  const { readyAgents, isLoading: agentsLoading } = useAgentCatalog();
  const modelRegistriesQuery = useModelRegistriesQuery();
  const modelRegistries = modelRegistriesQuery.data ?? EMPTY_MODEL_REGISTRIES;
  const { localWorkspaces = EMPTY_WORKSPACES, repoRoots = EMPTY_REPO_ROOTS } =
    useStandardRepoProjection();
  const hiddenRepoRootIds = useWorkspaceUiStore((state) => state.hiddenRepoRootIds);
  const archivedWorkspaceIds = useWorkspaceUiStore((state) => state.archivedWorkspaceIds);
  const workspaceLastInteracted = useWorkspaceUiStore((state) => state.workspaceLastInteracted);
  const repoConfigs = useRepoPreferencesStore((state) => state.repoConfigs);
  const { getWorkspaceRuntimeBlockReason } = useWorkspaceRuntimeBlock();

  const repositories = useMemo(() => {
    const hiddenRepoRootIdSet = new Set(hiddenRepoRootIds);
    return buildSettingsRepositoryEntries(
      localWorkspaces.filter((workspace) =>
        workspace.repoRootId ? !hiddenRepoRootIdSet.has(workspace.repoRootId) : true
      ),
      repoRoots.filter((repoRoot) => !hiddenRepoRootIdSet.has(repoRoot.id)),
    );
  }, [hiddenRepoRootIds, localWorkspaces, repoRoots]);

  const selectedRepository = useMemo(
    () => resolveHomeNextRepositorySelection(repositories, repositorySelection),
    [repositories, repositorySelection],
  );

  const selectedRepoRoot = useMemo(() => (
    selectedRepository
      ? repoRoots.find((repoRoot) => repoRoot.id === selectedRepository.repoRootId) ?? null
      : null
  ), [repoRoots, selectedRepository]);

  const branchQuery = useRepoRootGitBranchesQuery({
    repoRootId: selectedRepository?.repoRootId ?? null,
    enabled: !!selectedRepository,
  });
  const branchRefs = branchQuery.data ?? EMPTY_BRANCH_REFS;

  const branchOptions = useMemo(
    () => localBranchNames(branchRefs),
    [branchRefs],
  );

  const defaultBranchName = useMemo(() => (
    resolveHomeNextDefaultBranchName({
      branchRefs,
      savedDefaultBranch: selectedRepository
        ? repoConfigs[selectedRepository.sourceRoot]?.defaultBranch ?? null
        : null,
      repoRootDefaultBranch: selectedRepoRoot?.defaultBranch ?? null,
    })
  ), [branchRefs, repoConfigs, selectedRepoRoot?.defaultBranch, selectedRepository]);

  const selectedBranchName =
    selectedBranch && branchOptions.includes(selectedBranch)
      ? selectedBranch
      : defaultBranchName;

  const matchingWorkspace = selectedRepository && selectedBranchName
    ? findHomeNextMatchingWorkspace({
      workspaces: localWorkspaces,
      repoRootId: selectedRepository.repoRootId,
      branchName: selectedBranchName,
      archivedWorkspaceIds,
      workspaceLastInteracted,
    })
    : null;
  const workspaceBlockReason = getWorkspaceRuntimeBlockReason(matchingWorkspace?.id ?? null);

  const agentOptions = useMemo(
    () => buildHomeNextAgentOptions(readyAgents, modelRegistries),
    [modelRegistries, readyAgents],
  );
  const selectedAgent = useMemo(
    () => resolveSelectedHomeNextAgentOption(agentOptions, selectedAgentKind),
    [agentOptions, selectedAgentKind],
  );

  const launchTarget = useMemo<HomeNextLaunchTarget | null>(() => {
    if (!selectedRepository) {
      return { kind: "cowork" };
    }
    if (!selectedBranchName) {
      return null;
    }
    return {
      kind: "repository",
      repository: selectedRepository,
      branchName: selectedBranchName,
      existingWorkspaceId: matchingWorkspace?.id ?? null,
    };
  }, [matchingWorkspace?.id, selectedBranchName, selectedRepository]);

  const targetDisabledReason = useMemo(() => {
    if (agentsLoading || modelRegistriesQuery.isLoading) {
      return "Loading agents";
    }
    if (!selectedAgent) {
      return "No ready agents";
    }
    if (!selectedAgent.modelId) {
      return selectedAgent.disabledReason ?? "No launchable model";
    }
    if (!selectedRepository) {
      return null;
    }
    if (branchQuery.isLoading) {
      return "Loading branches";
    }
    if (branchQuery.isError) {
      return "Couldn't load branches";
    }
    if (branchOptions.length === 0) {
      return "No local branches found";
    }
    if (!selectedBranchName) {
      return "Choose a branch";
    }
    if (workspaceBlockReason) {
      return workspaceBlockReason;
    }
    return null;
  }, [
    agentsLoading,
    branchOptions.length,
    branchQuery.isError,
    branchQuery.isLoading,
    modelRegistriesQuery.isLoading,
    selectedAgent,
    selectedBranchName,
    selectedRepository,
    workspaceBlockReason,
  ]);

  return {
    agentOptions,
    selectedAgent,
    repositories,
    selectedRepository,
    branchOptions,
    selectedBranchName,
    branchQuery,
    launchTarget,
    targetDisabledReason,
    canLaunchTarget: targetDisabledReason === null && launchTarget !== null,
  };
}
