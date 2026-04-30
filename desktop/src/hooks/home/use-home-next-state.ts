import { useMemo } from "react";
import {
  type HomeNextDestination,
  type HomeNextModelSelection,
  type HomeNextRepoLaunchKind,
  type HomeNextRepositorySelection,
} from "@/lib/domain/home/home-next-launch";
import { useHomeNextModelSelection } from "@/hooks/home/use-home-next-model-selection";
import { useHomeNextModeSelection } from "@/hooks/home/use-home-next-mode-selection";
import { useHomeNextRepositorySelection } from "@/hooks/home/use-home-next-repository-selection";

interface UseHomeNextStateArgs {
  destination: HomeNextDestination;
  repositorySelection: HomeNextRepositorySelection;
  repoLaunchKind: HomeNextRepoLaunchKind;
  modelSelectionOverride: HomeNextModelSelection | null;
  baseBranchOverride: string | null;
  modeOverrideId: string | null;
}

export function useHomeNextState({
  destination,
  repositorySelection,
  repoLaunchKind,
  modelSelectionOverride,
  baseBranchOverride,
  modeOverrideId,
}: UseHomeNextStateArgs) {
  const model = useHomeNextModelSelection({ modelSelectionOverride });
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

  const targetDisabledReason = useMemo(() => {
    if (model.disabledReason) {
      return model.disabledReason;
    }
    if (destination === "cowork") {
      return null;
    }
    if (!repository.selectedRepository) {
      return "Choose a repository";
    }

    if (repoLaunchKind === "local") {
      return null;
    }

    if (repository.branchQuery.isLoading) {
      return "Loading branches";
    }
    if (repository.branchQuery.isError) {
      return "Couldn't load branches";
    }
    if (repository.branchOptions.length === 0) {
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

    return repository.launchTarget ? null : "Choose where to launch";
  }, [
    destination,
    model.disabledReason,
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
  ]);

  return {
    ...repository,
    ...model,
    modeOptions: mode.modeOptions,
    effectiveMode: mode.effectiveMode,
    effectiveModeId: mode.effectiveModeId,
    targetDisabledReason,
    canLaunchTarget:
      targetDisabledReason === null
      && repository.launchTarget !== null
      && model.effectiveModelSelection !== null,
  };
}
