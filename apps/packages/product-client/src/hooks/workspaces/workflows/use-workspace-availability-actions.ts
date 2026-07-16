import { useCallback } from "react";
import {
  getAnyHarnessClient,
  resolveRuntimeConnection,
  useAnyHarnessRuntimeContext,
  useMaterializeRepoRootMutation,
  useMaterializeWorkspaceAtRefMutation,
} from "@anyharness/sdk-react";
import {
  useCreateLocalMaterializationIntent,
  useReportMaterialization,
  useUnlinkMaterialization,
} from "@proliferate/cloud-sdk-react";
import { createCloudWorkspace } from "@proliferate/cloud-sdk/client/workspaces";
import { runOpenOnMacFlow } from "#product/lib/domain/workspaces/cloud/open-on-mac-orchestration";
import { cloudWorkspaceSyntheticId } from "#product/lib/domain/workspaces/cloud/cloud-ids";
import { useWorkspaceSelection } from "#product/hooks/workspaces/workflows/selection/use-workspace-selection";
import { useWorkspaceCollectionsInvalidationActions } from "#product/hooks/workspaces/cache/use-workspace-collections-invalidation";
import { useDesktopInstallId } from "#product/hooks/workspaces/derived/use-desktop-install-id";
import { useToastStore } from "#product/stores/toast/toast-store";

/**
 * Executes the workspace-copy availability actions (PR 5 Flows 2/3/5). All
 * orchestration stays here in product-client (never in product-ui or Tauri
 * commands); the pure sequencing lives in open-on-mac-orchestration.ts.
 *
 * Runtime routing: local materialization operations (clone/exact-ref) run
 * against the local Tauri/AnyHarness runtime via the PR 3 sdk-react mutations,
 * which resolve the local runtime connection from context. Cloud intent/report
 * calls go to the control plane.
 */
export function useWorkspaceAvailabilityActions() {
  const runtime = useAnyHarnessRuntimeContext();
  const materializeRepoRoot = useMaterializeRepoRootMutation().mutateAsync;
  const materializeWorkspaceAtRef = useMaterializeWorkspaceAtRefMutation().mutateAsync;
  const createIntent = useCreateLocalMaterializationIntent().mutateAsync;
  const report = useReportMaterialization().mutateAsync;
  const unlink = useUnlinkMaterialization().mutateAsync;
  const desktopInstallId = useDesktopInstallId();
  const { selectWorkspace } = useWorkspaceSelection();
  const { invalidateWorkspaceCollectionsForRuntime } = useWorkspaceCollectionsInvalidationActions();
  const showToast = useToastStore((state) => state.show);

  /**
   * Flow 2 / Flow 5 relink+recreate. Reuses the Cloud operationId across
   * retries; when no local repo root hosts the repository the caller must
   * supply a clone destination (prompted via the native folder picker).
   */
  const openOnThisMac = useCallback(async (args: {
    cloudWorkspaceId: string;
    existingRepoRootId: string | null;
    cloneDestinationPath: string | null;
  }): Promise<boolean> => {
    if (!desktopInstallId) {
      showToast("This Mac is not registered yet. Try again in a moment.");
      return false;
    }
    try {
      const result = await runOpenOnMacFlow(
        {
          existingRepoRootId: args.existingRepoRootId,
          cloneDestinationPath: args.cloneDestinationPath,
        },
        {
          createIntent: () =>
            createIntent({
              workspaceId: args.cloudWorkspaceId,
              body: { targetKind: "local_desktop", desktopInstallId },
            }),
          materializeRepoRoot: (input) => materializeRepoRoot(input),
          materializeWorkspaceAtRef: async (repoRootId, input) => {
            const response = await materializeWorkspaceAtRef({ repoRootId, input });
            return {
              workspaceId: response.workspace.id,
              observedHeadSha: response.observedHeadSha,
              worktreePath: response.workspace.path,
            };
          },
          report: (materializationId, body) =>
            report({ workspaceId: args.cloudWorkspaceId, materializationId, body }),
        },
      );
      const runtimeUrl = runtime.runtimeUrl?.trim() ?? "";
      if (runtimeUrl) {
        await invalidateWorkspaceCollectionsForRuntime(runtimeUrl);
      }
      // Select and open the local AnyHarness workspace.
      await selectWorkspace(result.anyharnessWorkspaceId, { force: true });
      return true;
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not open this workspace on this Mac.");
      return false;
    }
  }, [
    createIntent,
    desktopInstallId,
    invalidateWorkspaceCollectionsForRuntime,
    materializeRepoRoot,
    materializeWorkspaceAtRef,
    report,
    runtime.runtimeUrl,
    selectWorkspace,
    showToast,
  ]);

  /** Flow 3: add a managed-Cloud copy of a clean, published local workspace at
   * its exact ref. Reads the local exact HEAD from the runtime, then calls the
   * server exact-ref create path (which re-verifies the published head). */
  const addCloudCopy = useCallback(async (args: {
    localAnyharnessWorkspaceId: string;
    gitOwner: string;
    gitRepoName: string;
  }): Promise<boolean> => {
    try {
      const client = getAnyHarnessClient(resolveRuntimeConnection(runtime));
      const status = await client.git.getStatus(args.localAnyharnessWorkspaceId);
      if (
        status.detached
        || !status.currentBranch
        || !status.clean
        || status.conflicted
        || status.operation !== "none"
      ) {
        showToast("This workspace must be clean and on a normal branch to add a Cloud copy.");
        return false;
      }
      const worktreePath = status.repoRootPath;
      const detail = await createCloudWorkspace({
        gitProvider: "github",
        gitOwner: args.gitOwner,
        gitRepoName: args.gitRepoName,
        branchName: status.currentBranch,
        expectedHeadSha: status.headOid,
        source: "desktop",
        sourceMaterialization: desktopInstallId
          ? {
            targetKind: "local_desktop",
            desktopInstallId,
            anyharnessWorkspaceId: args.localAnyharnessWorkspaceId,
            worktreePath,
            observedHeadSha: status.headOid,
          }
          : null,
      });
      showToast("Added a Cloud copy.", "info");
      await selectWorkspace(cloudWorkspaceSyntheticId(detail.id), { force: true });
      return true;
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not add a Cloud copy.");
      return false;
    }
  }, [desktopInstallId, runtime, selectWorkspace, showToast]);

  /** Flow 5: unlink this Mac's association (non-destructive; idempotent). */
  const unlinkThisMac = useCallback(async (args: {
    cloudWorkspaceId: string;
    materializationId: string;
  }): Promise<boolean> => {
    try {
      await unlink({
        workspaceId: args.cloudWorkspaceId,
        materializationId: args.materializationId,
      });
      showToast("Unlinked this Mac. Nothing was deleted.", "info");
      return true;
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not unlink this Mac.");
      return false;
    }
  }, [showToast, unlink]);

  return {
    openOnThisMac,
    addCloudCopy,
    unlinkThisMac,
    desktopInstallId,
  };
}
