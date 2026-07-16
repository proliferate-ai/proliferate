import { AnyHarnessError, type RepoRoot } from "@anyharness/sdk";
import { useResolveRepoRootFromPathMutation } from "@anyharness/sdk-react";
import { useSaveRepoEnvironment } from "@proliferate/cloud-sdk-react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { useCallback, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  runAddRepoWorkflow,
  type ExpectedRepoIdentity,
} from "#product/lib/domain/workspaces/creation/add-repo-workflow";
import { useWorkspaceCollectionsInvalidationActions } from "#product/hooks/workspaces/cache/use-workspace-collections-invalidation";
import { useWorkspaceCollectionsMutationCacheActions } from "#product/hooks/workspaces/cache/use-workspace-collections-mutation-cache";
import { useWorkspaceUiStore } from "#product/stores/preferences/workspace-ui-store";
import { useRepoSetupModalStore } from "#product/stores/ui/repo-setup-modal-store";
import { useToastStore } from "#product/stores/toast/toast-store";
import { ensureRuntimeReady } from "#product/hooks/workspaces/workflows/runtime-ready";

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
  | { succeeded: true; sourceRoot: string }
  | { succeeded: false; error: string };

function isRepoEntryBlockedPath(pathname: string): boolean {
  // Global shortcuts can invoke this hook outside authenticated app surfaces.
  return pathname === "/login";
}

export function useAddRepo() {
  const desktop = useProductHost().desktop ?? null;
  const localRuntime = desktop?.runtime ?? null;
  const worker = desktop?.worker ?? null;
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

    if (!worker) {
      // No native desktop worker: do not fabricate a durable association with a
      // browser-local telemetry fallback id (stack identity rule).
      return;
    }

    void (async () => {
      // Use the native desktop install id so ownership of the saved local
      // environment is legible and cannot split identity via a telemetry
      // fallback.
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
      // Local repo registration remains usable when Cloud is unavailable.
    });
  }, [saveEnvironment, worker]);

  const addRepoFromPath = useCallback(async (
    path: string,
    options?: {
      createCloudEnvironment?: boolean;
      /** "Add to this Mac": the folder must prove this GitHub identity before
       * any mutation, and the local environment save is always attempted. */
      expectedRepoIdentity?: ExpectedRepoIdentity | null;
    },
  ): Promise<AddRepoFromPathResult> => {
    if (!canAddRepo) {
      return { succeeded: false, error: "Add repository is unavailable right now." };
    }

    // "Add to this Mac" always registers the local environment for the known
    // Cloud repo; the plain add-folder path leaves that to the setup modal.
    const createCloudEnvironment = options?.createCloudEnvironment
      ?? Boolean(options?.expectedRepoIdentity);
    setIsAddingRepo(true);
    try {
      const repoRoot = await runAddRepoWorkflow({
        path,
        ensureRuntimeReady: () => ensureRuntimeReady(localRuntime),
        resolveRepoRootFromPath: (repoPath) => resolveRepoRootFromPath(repoPath),
        expectedRepoIdentity: options?.expectedRepoIdentity ?? null,
        upsertRepoRootInWorkspaceCollections,
        invalidateWorkspaceCollections: invalidateWorkspaceCollectionsForRuntime,
        saveLocalRepoEnvironment: createCloudEnvironment
          ? saveLocalRepoEnvironment
          : undefined,
        unhideRepoRoot,
        openRepoSetupModal,
      });
      // Mirrors resolveRepoSourceRoot (lib/domain/settings/repositories.ts) so
      // completion callbacks can select the new settings repository entry.
      return { succeeded: true, sourceRoot: repoRoot.path.trim() || repoRoot.id };
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
    localRuntime,
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
