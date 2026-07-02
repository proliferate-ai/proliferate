import { AnyHarnessError, type RepoRoot } from "@anyharness/sdk";
import { useResolveRepoRootFromPathMutation } from "@anyharness/sdk-react";
import { useSaveRepoEnvironment } from "@proliferate/cloud-sdk-react";
import { useCallback, useState } from "react";
import { useLocation } from "react-router-dom";
import { runAddRepoWorkflow } from "@/lib/domain/workspaces/creation/add-repo-workflow";
import { loadAnonymousTelemetryBootstrap } from "@/lib/integrations/telemetry/anonymous-storage";
import { useWorkspaceCollectionsInvalidationActions } from "@/hooks/workspaces/cache/use-workspace-collections-invalidation";
import { useWorkspaceCollectionsMutationCacheActions } from "@/hooks/workspaces/cache/use-workspace-collections-mutation-cache";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import { useRepoSetupModalStore } from "@/stores/ui/repo-setup-modal-store";
import { useToastStore } from "@/stores/toast/toast-store";
import { ensureRuntimeReady } from "@/hooks/workspaces/workflows/runtime-ready";

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

export type AddRepoFromPathResult =
  | { succeeded: true }
  | { succeeded: false; error: string };

function isRepoEntryBlockedPath(pathname: string): boolean {
  // Global shortcuts can invoke this hook outside authenticated app surfaces.
  return pathname === "/login";
}

export function useAddRepo() {
  const location = useLocation();
  const { upsertRepoRootInWorkspaceCollections } = useWorkspaceCollectionsMutationCacheActions();
  const { invalidateWorkspaceCollectionsForRuntime } = useWorkspaceCollectionsInvalidationActions();
  const resolveRepoRootFromPath = useResolveRepoRootFromPathMutation().mutateAsync;
  const saveEnvironment = useSaveRepoEnvironment();
  const unhideRepoRoot = useWorkspaceUiStore((state) => state.unhideRepoRoot);
  const openRepoSetupModal = useRepoSetupModalStore((state) => state.open);
  const showToast = useToastStore((state) => state.show);
  const [isAddingRepo, setIsAddingRepo] = useState(false);
  const canAddRepo = !isRepoEntryBlockedPath(location.pathname);
  const saveLocalRepoEnvironment = useCallback((repoRoot: RepoRoot) => {
    const gitOwner = repoRoot.remoteOwner?.trim();
    const gitRepoName = repoRoot.remoteRepoName?.trim();
    if (
      repoRoot.remoteProvider !== "github"
      || !gitOwner
      || !gitRepoName
      || !repoRoot.path.trim()
    ) {
      return;
    }

    void (async () => {
      const { installId } = await loadAnonymousTelemetryBootstrap();
      await saveEnvironment.mutateAsync({
        gitOwner,
        gitRepoName,
        body: {
          kind: "local",
          gitProvider: "github",
          desktopInstallId: installId,
          localPath: repoRoot.path,
          defaultBranch: repoRoot.defaultBranch?.trim() || null,
          setupScript: "",
          runCommand: "",
        },
      });
    })().catch(() => {
      // Local repo registration remains usable when Cloud is unavailable.
    });
  }, [saveEnvironment]);

  const addRepoFromPath = useCallback(async (
    path: string,
    options?: { createCloudEnvironment?: boolean },
  ): Promise<AddRepoFromPathResult> => {
    if (!canAddRepo) {
      return { succeeded: false, error: "Add repository is unavailable right now." };
    }

    const createCloudEnvironment = options?.createCloudEnvironment ?? true;
    setIsAddingRepo(true);
    try {
      await runAddRepoWorkflow({
        path,
        ensureRuntimeReady,
        resolveRepoRootFromPath: (repoPath) => resolveRepoRootFromPath(repoPath),
        upsertRepoRootInWorkspaceCollections,
        invalidateWorkspaceCollections: invalidateWorkspaceCollectionsForRuntime,
        saveLocalRepoEnvironment: createCloudEnvironment
          ? saveLocalRepoEnvironment
          : undefined,
        unhideRepoRoot,
        openRepoSetupModal,
      });
      return { succeeded: true };
    } catch (error) {
      const message = describeAddRepoFailure(error);
      showToast(message);
      return { succeeded: false, error: message };
    } finally {
      setIsAddingRepo(false);
    }
  }, [
    canAddRepo,
    invalidateWorkspaceCollectionsForRuntime,
    openRepoSetupModal,
    resolveRepoRootFromPath,
    saveLocalRepoEnvironment,
    showToast,
    unhideRepoRoot,
    upsertRepoRootInWorkspaceCollections,
  ]);

  return {
    addRepoFromPath,
    canAddRepo,
    addRepoDisabledReason: canAddRepo
      ? null
      : "Add repository is unavailable right now.",
    isAddingRepo,
  };
}
