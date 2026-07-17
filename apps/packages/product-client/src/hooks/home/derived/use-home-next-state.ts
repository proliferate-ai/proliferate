import { useMemo } from "react";
import {
  type HomeNextDestination,
  type HomeNextModelSelection,
  type HomeNextRepoLaunchKind,
  type HomeNextRepositorySelection,
} from "#product/lib/domain/home/home-next-launch";
import { useHomeNextModelSelection } from "#product/hooks/home/derived/use-home-next-model-selection";
import { useHomeNextModeSelection } from "#product/hooks/home/derived/use-home-next-mode-selection";
import { useHomeNextRepositorySelection } from "#product/hooks/home/derived/use-home-next-repository-selection";
import { useComputeTargetOptions } from "#product/hooks/compute/derived/use-compute-target-options";

interface UseHomeNextStateArgs {
  desktopTargetsAvailable: boolean;
  destination: HomeNextDestination;
  repositorySelection: HomeNextRepositorySelection;
  repoLaunchKind: HomeNextRepoLaunchKind;
  modelSelectionOverride: HomeNextModelSelection | null;
  baseBranchOverride: string | null;
  modeOverrideId: string | null;
  selectedSshTargetId?: string | null;
}

// Owns read-only Home Next launch state composition. Does not own launch actions.
export function useHomeNextState({
  desktopTargetsAvailable,
  destination,
  repositorySelection,
  repoLaunchKind,
  modelSelectionOverride,
  baseBranchOverride,
  modeOverrideId,
  selectedSshTargetId = null,
}: UseHomeNextStateArgs) {
  const effectiveDestination = desktopTargetsAvailable ? destination : "repository";
  const effectiveRepoLaunchKind = desktopTargetsAvailable ? repoLaunchKind : "cloud";
  const model = useHomeNextModelSelection({
    modelSelectionOverride,
    repoLaunchKind: effectiveRepoLaunchKind,
  });
  const repository = useHomeNextRepositorySelection({
    destination: effectiveDestination,
    repositorySelection,
    repoLaunchKind: effectiveRepoLaunchKind,
    baseBranchOverride,
  });
  const mode = useHomeNextModeSelection({
    destination: effectiveDestination,
    modelSelection: model.effectiveModelSelection,
    modeOverrideId,
  });
  const computeTargets = useComputeTargetOptions({
    enabled: desktopTargetsAvailable && effectiveDestination === "repository",
  });
  const sshTargetOptions = desktopTargetsAvailable ? computeTargets.sshTargetOptions : [];
  const selectedSshTarget = sshTargetOptions.find((target) =>
    target.id === selectedSshTargetId
  ) ?? null;
  const launchTarget =
    desktopTargetsAvailable || repository.launchTarget?.kind === "cloud"
      ? repository.launchTarget
      : null;

  const targetDisabledReason = useMemo(() => {
    if (effectiveDestination === "cowork") {
      return null;
    }
    if (!repository.selectedRepository) {
      return "Choose a repository";
    }

    if (effectiveRepoLaunchKind === "local") {
      return null;
    }

    const selectedRepositoryIsCloudOnly = repository.selectedRepository.availability === "cloud";
    if (!selectedRepositoryIsCloudOnly && repository.branchQuery.isLoading) {
      return "Loading branches";
    }
    if (!selectedRepositoryIsCloudOnly && repository.branchQuery.isError) {
      return "Couldn't load branches";
    }
    if (!selectedRepositoryIsCloudOnly && repository.branchOptions.length === 0) {
      return "No local branches found";
    }
    if (!repository.selectedBranchName) {
      return "Choose a base branch";
    }

    if (effectiveRepoLaunchKind === "cloud") {
      if (!repository.cloudActive) {
        return "Sign in to use cloud workspaces";
      }
      if (!repository.cloudRepoTarget) {
        return "Cloud is unavailable for this repository";
      }
      if (repository.cloudRepoAction.kind === "loading") {
        return "Loading cloud configuration";
      }
      if (repository.cloudRepoAction.kind === "configure") {
        return repository.cloudRepoAction.label;
      }
      if (repository.cloudRepoAction.kind !== "create") {
        return "Cloud is unavailable for this repository";
      }
    }

    if (effectiveRepoLaunchKind === "ssh") {
      if (computeTargets.isLoading) {
        return "Loading SSH targets";
      }
      if (computeTargets.sshTargetOptions.length === 0) {
        return "Add an SSH target before launching there";
      }
      if (!selectedSshTarget) {
        return "Choose an SSH target";
      }
      if (selectedSshTarget.disabledReason) {
        return selectedSshTarget.disabledReason;
      }
      return "SSH target launches are not wired yet";
    }

    return launchTarget ? null : "Choose where to launch";
  }, [
    computeTargets.isLoading,
    computeTargets.sshTargetOptions.length,
    effectiveDestination,
    effectiveRepoLaunchKind,
    launchTarget,
    repository.branchOptions.length,
    repository.branchQuery.isError,
    repository.branchQuery.isLoading,
    repository.cloudActive,
    repository.cloudRepoAction.kind,
    repository.cloudRepoTarget,
    repository.launchTarget,
    repository.selectedBranchName,
    repository.selectedRepository,
    selectedSshTarget,
  ]);

  return {
    ...repository,
    launchTarget,
    sshTargetOptions,
    sshTargetsLoading: desktopTargetsAvailable && computeTargets.isLoading,
    selectedSshTarget,
    ...model,
    modeOptions: mode.modeOptions,
    effectiveMode: mode.effectiveMode,
    effectiveModeId: mode.effectiveModeId,
    targetDisabledReason,
    canLaunchTarget:
      targetDisabledReason === null
      && launchTarget !== null,
  };
}
