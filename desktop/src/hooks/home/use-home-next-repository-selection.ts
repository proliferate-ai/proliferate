import { useMemo } from "react";
import type { GitBranchRef, RepoRoot, Workspace } from "@anyharness/sdk";
import { useRepoRootGitBranchesQuery } from "@anyharness/sdk-react";
import { useCloudAvailabilityState } from "@/hooks/cloud/use-cloud-availability-state";
import { useCloudRepoConfigs } from "@/hooks/access/cloud/use-cloud-repo-configs";
import { useStandardRepoProjection } from "@/hooks/workspaces/use-standard-repo-projection";
import {
  buildCloudRepoActionBySourceRoot,
  buildConfiguredCloudRepoKeys,
  resolveCloudRepoActionState,
  type CloudRepoActionState,
  type CloudWorkspaceRepoTarget,
} from "@/lib/domain/workspaces/cloud-workspace-creation";
import {
  findHomeNextLocalWorkspace,
  localBranchNames,
  resolveHomeLaunchTarget,
  resolveHomeNextDefaultBranchName,
  resolveHomeNextRepositorySelection,
  type HomeLaunchTarget,
  type HomeNextDestination,
  type HomeNextRepoLaunchKind,
  type HomeNextRepositorySelection,
} from "@/lib/domain/home/home-next-launch";
import { buildSettingsRepositoryEntries } from "@/lib/domain/settings/repositories";
import { useRepoPreferencesStore } from "@/stores/preferences/repo-preferences-store";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";

const EMPTY_WORKSPACES: Workspace[] = [];
const EMPTY_REPO_ROOTS: RepoRoot[] = [];
const EMPTY_BRANCH_REFS: GitBranchRef[] = [];

interface UseHomeNextRepositorySelectionArgs {
  destination: HomeNextDestination;
  repositorySelection: HomeNextRepositorySelection;
  repoLaunchKind: HomeNextRepoLaunchKind;
  baseBranchOverride: string | null;
}

export function useHomeNextRepositorySelection({
  destination,
  repositorySelection,
  repoLaunchKind,
  baseBranchOverride,
}: UseHomeNextRepositorySelectionArgs) {
  const { localWorkspaces = EMPTY_WORKSPACES, repoRoots = EMPTY_REPO_ROOTS } =
    useStandardRepoProjection();
  const hiddenRepoRootIds = useWorkspaceUiStore((state) => state.hiddenRepoRootIds);
  const archivedWorkspaceIds = useWorkspaceUiStore((state) => state.archivedWorkspaceIds);
  const workspaceLastInteracted = useWorkspaceUiStore((state) => state.workspaceLastInteracted);
  const repoConfigs = useRepoPreferencesStore((state) => state.repoConfigs);
  const { cloudActive } = useCloudAvailabilityState();
  const cloudRepoConfigsQuery = useCloudRepoConfigs(cloudActive);

  const repositories = useMemo(() => {
    const hiddenRepoRootIdSet = new Set(hiddenRepoRootIds);
    return buildSettingsRepositoryEntries(
      localWorkspaces.filter((workspace) =>
        workspace.repoRootId ? !hiddenRepoRootIdSet.has(workspace.repoRootId) : true
      ),
      repoRoots.filter((repoRoot) => !hiddenRepoRootIdSet.has(repoRoot.id)),
    );
  }, [hiddenRepoRootIds, localWorkspaces, repoRoots]);

  const selectedRepository = useMemo(() => (
    destination === "repository"
      ? resolveHomeNextRepositorySelection(repositories, repositorySelection)
      : null
  ), [destination, repositories, repositorySelection]);

  const selectedRepoRoot = useMemo(() => (
    selectedRepository
      ? repoRoots.find((repoRoot) => repoRoot.id === selectedRepository.repoRootId) ?? null
      : null
  ), [repoRoots, selectedRepository]);

  const branchQuery = useRepoRootGitBranchesQuery({
    repoRootId: selectedRepository?.repoRootId ?? null,
    enabled: !!selectedRepository && (repoLaunchKind === "worktree" || repoLaunchKind === "cloud"),
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
    baseBranchOverride && branchOptions.includes(baseBranchOverride)
      ? baseBranchOverride
      : defaultBranchName;

  const existingLocalWorkspace = selectedRepository
    ? findHomeNextLocalWorkspace({
      workspaces: localWorkspaces,
      repoRootId: selectedRepository.repoRootId,
      archivedWorkspaceIds,
      workspaceLastInteracted,
    })
    : null;

  const cloudRepoTarget = useMemo<CloudWorkspaceRepoTarget | null>(() => {
    const gitOwner = selectedRepository?.gitOwner?.trim();
    const gitRepoName = selectedRepository?.gitRepoName?.trim();
    return gitOwner && gitRepoName
      ? { gitOwner, gitRepoName }
      : null;
  }, [selectedRepository]);
  const configuredCloudRepoKeys = useMemo(
    () => buildConfiguredCloudRepoKeys(cloudRepoConfigsQuery.data?.configs),
    [cloudRepoConfigsQuery.data?.configs],
  );
  const cloudRepoConfigsInitialLoading =
    cloudActive && cloudRepoConfigsQuery.isPending && !cloudRepoConfigsQuery.data;
  const cloudRepoActionBySourceRoot = useMemo(() => buildCloudRepoActionBySourceRoot({
    repositories,
    cloudActive,
    configuredRepoKeys: configuredCloudRepoKeys,
    isInitialConfigLoad: cloudRepoConfigsInitialLoading,
  }), [
    cloudActive,
    cloudRepoConfigsInitialLoading,
    configuredCloudRepoKeys,
    repositories,
  ]);
  const cloudRepoAction = useMemo<CloudRepoActionState>(
    () => resolveCloudRepoActionState({
      repoTarget: cloudRepoTarget,
      configuredRepoKeys: configuredCloudRepoKeys,
      isInitialConfigLoad: cloudRepoConfigsInitialLoading,
    }),
    [cloudRepoConfigsInitialLoading, cloudRepoTarget, configuredCloudRepoKeys],
  );

  const launchTarget = useMemo<HomeLaunchTarget | null>(() =>
    resolveHomeLaunchTarget({
      destination,
      repository: selectedRepository,
      repoLaunchKind,
      baseBranch: selectedBranchName,
      existingLocalWorkspaceId: existingLocalWorkspace?.id ?? null,
    }), [
    destination,
    existingLocalWorkspace?.id,
    repoLaunchKind,
    selectedBranchName,
    selectedRepository,
  ]);

  return {
    repositories,
    selectedRepository,
    selectedRepoRoot,
    existingLocalWorkspace,
    branchOptions,
    selectedBranchName,
    branchQuery,
    cloudActive,
    cloudRepoAction,
    cloudRepoActionBySourceRoot,
    cloudRepoTarget,
    cloudRepoConfigsInitialLoading,
    launchTarget,
  };
}
