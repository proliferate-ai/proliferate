import { useMemo } from "react";
import {
  type HomeNextDestination,
  type HomeNextModelSelection,
  type HomeNextRepoLaunchKind,
  type HomeNextRepositorySelection,
} from "@/lib/domain/home/home-next-launch";
import { useHomeNextModelSelection } from "@/hooks/home/derived/use-home-next-model-selection";
import { useHomeNextModeSelection } from "@/hooks/home/derived/use-home-next-mode-selection";
import { useHomeNextRepositorySelection } from "@/hooks/home/derived/use-home-next-repository-selection";
import { useComputeTargetOptions } from "@/hooks/compute/derived/use-compute-target-options";

interface UseHomeNextStateArgs {
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
  destination,
  repositorySelection,
  repoLaunchKind,
  modelSelectionOverride,
  baseBranchOverride,
  modeOverrideId,
  selectedSshTargetId = null,
}: UseHomeNextStateArgs) {
  const model = useHomeNextModelSelection({ modelSelectionOverride, repoLaunchKind });
  const repository = useHomeNextRepositorySelection({
    destination,
    repositorySelection,
    repoLaunchKind,
    baseBranchOverride,
  });
  const mode = useHomeNextModeSelection({
    destination,
    modelSelection: model.effectiveModelSelection,
    modeOverrideId,
  });
  const computeTargets = useComputeTargetOptions({
    enabled: destination === "repository",
  });
  const selectedSshTarget = computeTargets.sshTargetOptions.find((target) =>
    target.id === selectedSshTargetId
  ) ?? null;

  const targetDisabledReason = useMemo(() => {
    if (destination === "cowork") {
      return null;
    }
    if (!repository.selectedRepository) {
      return "Choose a repository";
    }

    if (repoLaunchKind === "local") {
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

    if (repoLaunchKind === "cloud") {
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
        return "Configure cloud for this repository";
      }
      if (repository.cloudRepoAction.kind !== "create") {
        return "Cloud is unavailable for this repository";
      }
    }

    if (repoLaunchKind === "ssh") {
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

    return repository.launchTarget ? null : "Choose where to launch";
  }, [
    computeTargets.isLoading,
    computeTargets.sshTargetOptions.length,
    destination,
    repoLaunchKind,
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
    sshTargetOptions: computeTargets.sshTargetOptions,
    sshTargetsLoading: computeTargets.isLoading,
    selectedSshTarget,
    ...model,
    modeOptions: mode.modeOptions,
    effectiveMode: mode.effectiveMode,
    effectiveModeId: mode.effectiveModeId,
    targetDisabledReason,
    canLaunchTarget:
      targetDisabledReason === null
      && repository.launchTarget !== null,
  };
}
