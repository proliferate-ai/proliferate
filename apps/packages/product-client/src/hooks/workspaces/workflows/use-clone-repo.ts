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
import { directoryPickerUnavailableCopy } from "#product/copy/workspaces/directory-picker-copy";

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

export interface CloneRepoAttempt {
  /** Unique to one chosen destination, and reused only when retrying it. */
  operationId: string;
  destinationPath: string;
}

export type CloneRepoResult =
  | { succeeded: true; sourceRoot: string }
  | { succeeded: false; error: string; cancelled?: boolean; attempt?: CloneRepoAttempt };

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

  /** Clone `repo` into a subfolder of the user-picked parent directory.
   *
   * A fresh attempt receives a random operation id only AFTER its destination
   * is known. A retry passes the returned attempt back verbatim. This keeps the
   * id stable for one destination without incorrectly reusing it for every
   * future clone of the same repository (PR5-CLONE-ID-02). */
  const cloneRepo = useCallback(async (
    repo: ExpectedRepoIdentity,
    retryAttempt?: CloneRepoAttempt,
  ): Promise<CloneRepoResult> => {
    if (!files) {
      return { succeeded: false, error: "Cloning is only available in Desktop." };
    }
    let attempt = retryAttempt;
    if (!attempt) {
      const picked = await files.pickDirectory();
      if (picked.kind === "cancelled") {
        return { succeeded: false, error: "Clone cancelled.", cancelled: true };
      }
      if (picked.kind === "unavailable") {
        return {
          succeeded: false,
          error: directoryPickerUnavailableCopy(picked.reason),
        };
      }
      attempt = {
        operationId: `clone:${crypto.randomUUID()}`,
        destinationPath: `${picked.path.replace(/\/+$/u, "")}/${repo.gitRepoName}`,
      };
    }
    setIsCloning(true);
    try {
      const repoRoot = await runCloneRepoWorkflow({
        repo,
        destinationPath: attempt.destinationPath,
        operationId: attempt.operationId,
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
      return { succeeded: false, error: message, attempt };
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
