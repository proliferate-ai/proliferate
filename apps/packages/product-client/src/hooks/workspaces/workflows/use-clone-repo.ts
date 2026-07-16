import { AnyHarnessError, type RepoRoot } from "@anyharness/sdk";
import { useMaterializeRepoRootMutation } from "@anyharness/sdk-react";
import { useSaveRepoEnvironment } from "@proliferate/cloud-sdk-react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { useCallback, useState } from "react";
import {
  AddRepoIdentityMismatchError,
  type ExpectedRepoIdentity,
} from "#product/lib/domain/workspaces/creation/add-repo-workflow";
import { runCloneRepoWorkflow } from "#product/lib/domain/workspaces/creation/clone-repo-workflow";
import { useWorkspaceCollectionsInvalidationActions } from "#product/hooks/workspaces/cache/use-workspace-collections-invalidation";
import { useWorkspaceCollectionsMutationCacheActions } from "#product/hooks/workspaces/cache/use-workspace-collections-mutation-cache";
import { useWorkspaceUiStore } from "#product/stores/preferences/workspace-ui-store";
import { useToastStore } from "#product/stores/toast/toast-store";
import { ensureRuntimeReady } from "#product/hooks/workspaces/workflows/runtime-ready";

/** Map a clone failure to a user-facing message, naming local Git auth and the
 * PR 3 typed errors without leaking sandbox paths. */
function describeCloneFailure(error: unknown): string {
  if (error instanceof AddRepoIdentityMismatchError) {
    return error.message;
  }
  if (error instanceof AnyHarnessError) {
    switch (error.problem.code) {
      case "REPOSITORY_AUTH_REQUIRED":
        return "Cloning requires local Git credentials for this repository. "
          + "Sign in to GitHub in your local Git setup and try again.";
      case "REPOSITORY_REMOTE_MISMATCH":
        return "The destination already contains a different repository.";
      case "DESTINATION_NOT_EMPTY":
        return "The chosen folder is not empty. Pick an empty destination folder.";
      case "DESTINATION_OUTSIDE_ALLOWED_ROOT":
        return "The chosen folder is outside an allowed location.";
      case "DESTINATION_CONFLICT":
        return "Another repository already occupies the chosen folder.";
      case "REPO_ROOT_WORKTREE_UNSUPPORTED":
        return "The chosen folder is a Git worktree. Choose a plain destination folder.";
      default:
        return error.problem.detail ?? error.message;
    }
  }
  return error instanceof Error ? error.message : "Failed to clone repository.";
}

export type CloneRepoResult =
  | { succeeded: true; sourceRoot: string }
  | { succeeded: false; error: string; cancelled?: boolean };

export function useCloneRepo() {
  const desktop = useProductHost().desktop ?? null;
  const files = desktop?.files ?? null;
  const localRuntime = desktop?.runtime ?? null;
  const worker = desktop?.worker ?? null;
  const materializeRepoRoot = useMaterializeRepoRootMutation().mutateAsync;
  const saveEnvironment = useSaveRepoEnvironment();
  const { upsertRepoRootInWorkspaceCollections } = useWorkspaceCollectionsMutationCacheActions();
  const { invalidateWorkspaceCollectionsForRuntime } = useWorkspaceCollectionsInvalidationActions();
  const unhideRepoRoot = useWorkspaceUiStore((state) => state.unhideRepoRoot);
  const showToast = useToastStore((state) => state.show);
  const [isCloning, setIsCloning] = useState(false);

  const saveLocalRepoEnvironment = useCallback((repoRoot: RepoRoot) => {
    const gitOwner = repoRoot.remoteOwner?.trim();
    const gitRepoName = repoRoot.remoteRepoName?.trim();
    if (
      repoRoot.remoteProvider !== "github"
      || !gitOwner
      || !gitRepoName
      || !repoRoot.path.trim()
      || !worker
    ) {
      return;
    }
    void (async () => {
      const installId = await worker.getInstallId();
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
      // Local clone remains usable even when the environment save fails.
    });
  }, [saveEnvironment, worker]);

  /** Clone `repo` into a subfolder of the user-picked parent directory. The
   * native folder picker chooses the parent; the clone lands in
   * `<parent>/<repoName>`. `operationId` must be stable across retries. */
  const cloneRepo = useCallback(async (
    repo: ExpectedRepoIdentity,
    operationId: string,
  ): Promise<CloneRepoResult> => {
    if (!files) {
      return { succeeded: false, error: "Cloning is only available in Desktop." };
    }
    const parent = await files.pickDirectory();
    if (!parent) {
      return { succeeded: false, error: "Clone cancelled.", cancelled: true };
    }
    const destinationPath = `${parent.replace(/\/+$/u, "")}/${repo.gitRepoName}`;
    setIsCloning(true);
    try {
      const repoRoot = await runCloneRepoWorkflow({
        repo,
        destinationPath,
        operationId,
        ensureRuntimeReady: () => ensureRuntimeReady(localRuntime),
        materializeRepoRoot: (input) => materializeRepoRoot(input),
        upsertRepoRootInWorkspaceCollections,
        invalidateWorkspaceCollections: invalidateWorkspaceCollectionsForRuntime,
        saveLocalRepoEnvironment,
        unhideRepoRoot,
      });
      return { succeeded: true, sourceRoot: repoRoot.path.trim() || repoRoot.id };
    } catch (error) {
      const message = describeCloneFailure(error);
      showToast(message);
      return { succeeded: false, error: message };
    } finally {
      setIsCloning(false);
    }
  }, [
    files,
    invalidateWorkspaceCollectionsForRuntime,
    localRuntime,
    materializeRepoRoot,
    saveLocalRepoEnvironment,
    showToast,
    unhideRepoRoot,
    upsertRepoRootInWorkspaceCollections,
  ]);

  return {
    cloneRepo,
    canClone: files !== null,
    isCloning,
  };
}
