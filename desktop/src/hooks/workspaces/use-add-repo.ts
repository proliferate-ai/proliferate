import { AnyHarnessError } from "@anyharness/sdk";
import { useResolveRepoRootFromPathMutation } from "@anyharness/sdk-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { useLocation } from "react-router-dom";
import { runAddRepoWorkflow } from "@/lib/domain/workspaces/creation/add-repo-workflow";
import { pickFolder } from "@/platform/tauri/shell";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import { useRepoSetupModalStore } from "@/stores/ui/repo-setup-modal-store";
import { useToastStore } from "@/stores/toast/toast-store";
import { workspaceCollectionsScopeKey } from "./query-keys";
import { ensureRuntimeReady } from "./runtime-ready";

function describeAddRepoFailure(error: unknown): string {
  if (error instanceof AnyHarnessError) {
    switch (error.problem.code) {
      case "REPO_ROOT_NOT_GIT_REPO":
      case "REPO_WORKSPACE_NOT_GIT_REPO":
        return "Selected folder is not a Git repository.";
      case "REPO_ROOT_WORKTREE_UNSUPPORTED":
      case "REPO_WORKSPACE_WORKTREE_UNSUPPORTED":
        return "Select the main repository root, not a worktree.";
      default:
        return error.problem.detail ?? error.message;
    }
  }

  return error instanceof Error ? error.message : "Failed to add repository.";
}

function isRepoEntryBlockedPath(pathname: string): boolean {
  // Global shortcuts can invoke this hook outside authenticated app surfaces.
  return pathname === "/login";
}

export function useAddRepo() {
  const location = useLocation();
  const queryClient = useQueryClient();
  const resolveRepoRootFromPath = useResolveRepoRootFromPathMutation().mutateAsync;
  const unhideRepoRoot = useWorkspaceUiStore((state) => state.unhideRepoRoot);
  const openRepoSetupModal = useRepoSetupModalStore((state) => state.open);
  const showToast = useToastStore((state) => state.show);
  const [isAddingRepo, setIsAddingRepo] = useState(false);
  const canAddRepo = !isRepoEntryBlockedPath(location.pathname);

  const addRepoFromPath = useCallback(async (path: string) => {
    if (!canAddRepo) {
      return;
    }

    setIsAddingRepo(true);
    try {
      await runAddRepoWorkflow({
        path,
        queryClient,
        ensureRuntimeReady,
        resolveRepoRootFromPath: (repoPath) => resolveRepoRootFromPath(repoPath),
        unhideRepoRoot,
        openRepoSetupModal,
        workspaceCollectionsScopeKey,
      });
    } catch (error) {
      showToast(describeAddRepoFailure(error));
    } finally {
      setIsAddingRepo(false);
    }
  }, [canAddRepo, openRepoSetupModal, queryClient, resolveRepoRootFromPath, showToast, unhideRepoRoot]);

  const addRepoFromPicker = useCallback(async () => {
    if (!canAddRepo) {
      return;
    }

    const path = await pickFolder();
    if (!path) {
      return;
    }

    await addRepoFromPath(path);
  }, [addRepoFromPath, canAddRepo]);

  return {
    addRepoFromPath,
    addRepoFromPicker,
    canAddRepo,
    addRepoDisabledReason: canAddRepo
      ? null
      : "Add repository is unavailable right now.",
    isAddingRepo,
  };
}
