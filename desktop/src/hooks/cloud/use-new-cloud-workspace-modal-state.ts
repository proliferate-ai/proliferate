import { useCallback, useState } from "react";
import { useCloudRepoBranches } from "@/hooks/cloud/use-cloud-repo-branches";
import { useWorkspaceEntryActions } from "@/hooks/workspaces/use-workspace-entry-actions";
import {
  buildCreateCloudWorkspaceRequest,
  normalizeCloudWorkspaceBranchName,
  resolveNewCloudWorkspaceBaseBranch,
  type NewCloudWorkspaceSeed,
} from "@/lib/domain/workspaces/cloud-workspace-creation";

const EMPTY_BRANCHES: string[] = [];

interface UseNewCloudWorkspaceModalStateArgs {
  seed: NewCloudWorkspaceSeed;
  onCreated: () => void;
}

interface NewCloudWorkspaceModalState {
  repoLabel: string;
  availableBranches: string[];
  baseBranch: string;
  branchName: string;
  setBaseBranch: (value: string) => void;
  setBranchName: (value: string) => void;
  isLoadingBranches: boolean;
  isSubmitting: boolean;
  displayError: string | null;
  canSubmit: boolean;
  handleCreate: () => Promise<void>;
}

export function useNewCloudWorkspaceModalState({
  seed,
  onCreated,
}: UseNewCloudWorkspaceModalStateArgs): NewCloudWorkspaceModalState {
  const { createCloudWorkspaceAndEnter, isCreatingCloudWorkspace } = useWorkspaceEntryActions();
  const {
    data: branchPayload,
    isLoading: isLoadingBranches,
    error: branchLoadError,
  } = useCloudRepoBranches(seed.gitOwner, seed.gitRepoName);

  const [baseBranchOverride, setBaseBranchOverride] = useState("");
  const [branchName, setBranchName] = useState(
    () => normalizeCloudWorkspaceBranchName(seed.prefillBranchName ?? ""),
  );

  const repoLabel = `${seed.gitOwner}/${seed.gitRepoName}`;
  const availableBranches = branchPayload?.branches ?? EMPTY_BRANCHES;
  const baseBranch = resolveNewCloudWorkspaceBaseBranch(
    baseBranchOverride,
    branchPayload?.defaultBranch,
  );
  const normalizedBranchName = normalizeCloudWorkspaceBranchName(branchName);
  const branchErrorMessage = branchLoadError instanceof Error ? branchLoadError.message : null;
  const displayError = branchErrorMessage;
  const canSubmit = !isCreatingCloudWorkspace
    && !isLoadingBranches
    && baseBranch.length > 0
    && normalizedBranchName.length > 0;

  const handleCreate = useCallback(async () => {
    if (!canSubmit) {
      return;
    }

    onCreated();
    await createCloudWorkspaceAndEnter(
      buildCreateCloudWorkspaceRequest(seed, {
        baseBranch,
        branchName,
      }),
    );
  }, [
    baseBranch,
    branchName,
    canSubmit,
    createCloudWorkspaceAndEnter,
    onCreated,
    seed,
  ]);

  return {
    repoLabel,
    availableBranches,
    baseBranch,
    branchName,
    setBaseBranch: setBaseBranchOverride,
    setBranchName,
    isLoadingBranches,
    isSubmitting: isCreatingCloudWorkspace,
    displayError,
    canSubmit,
    handleCreate,
  };
}
