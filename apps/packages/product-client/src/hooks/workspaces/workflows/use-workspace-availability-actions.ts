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
import { isStaleMaterializationGenerationError } from "#product/lib/domain/workspaces/cloud/materialization-report-error";
import {
  type LinkCloudTargetProof,
  type LinkLocalCandidateProof,
  verifyLinkCandidate,
} from "#product/lib/domain/workspaces/cloud/link-copies-verification";
import type { LinkCandidate } from "#product/lib/domain/workspaces/cloud/link-copies-candidates";
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
   * Flow 2 (open) / Flow 5 (relink + recreate). Reuses the Cloud operationId
   * across retries; when no local repo root hosts the repository the caller must
   * supply a clone destination (prompted via the native folder picker).
   * `forceFreshWorktree` distinguishes recreate (always cut a new worktree) from
   * relink/open (reuse/adopt a clean checkout at the ref) — PR5-MODE-03.
   */
  const openOnThisMac = useCallback(async (args: {
    cloudWorkspaceId: string;
    existingRepoRootId: string | null;
    cloneDestinationPath: string | null;
    forceFreshWorktree?: boolean;
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
          forceFreshWorktree: args.forceFreshWorktree,
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
      if (isStaleMaterializationGenerationError(error)) {
        // The worktree materialized fine; the association just moved on (a newer
        // intent or an unlink bumped the generation). Quiet, non-error state:
        // refresh so the sidebar reflects the current ledger (PR5-STALE-07).
        const runtimeUrl = runtime.runtimeUrl?.trim() ?? "";
        if (runtimeUrl) {
          await invalidateWorkspaceCollectionsForRuntime(runtimeUrl);
        }
        showToast("This workspace's link was updated elsewhere; nothing to do here.", "info");
        return true;
      }
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

  /**
   * Flow 4 "Link copies": association-only. Proves the chosen EXISTING local
   * workspace is the SAME exact ref as the Cloud copy (canonical repo identity,
   * case-sensitive branch, EXACT HEAD, clean/normal state, not already linked
   * elsewhere) by reading the local runtime git status fresh, then verifying via
   * the pure gate. On proof it cuts NO worktree: it creates the Cloud intent
   * (which independently re-verifies the published HEAD) and reports the EXISTING
   * local workspace as hydrated. On any proof failure it surfaces a truthful
   * blocker and NEVER materializes (PR5-LINK-01).
   */
  const linkCopies = useCallback(async (args: {
    candidate: LinkCandidate;
    cloudTarget: LinkCloudTargetProof;
    /** Cloud workspace ids this candidate is already linked to, for the
     * "not already linked elsewhere" proof. */
    alreadyLinkedCloudWorkspaceId: string | null;
  }): Promise<boolean> => {
    if (!desktopInstallId) {
      showToast("This Mac is not registered yet. Try again in a moment.");
      return false;
    }
    let proof: LinkLocalCandidateProof;
    try {
      const client = getAnyHarnessClient(resolveRuntimeConnection(runtime));
      const status = await client.git.getStatus(args.candidate.anyharnessWorkspaceId);
      proof = {
        anyharnessWorkspaceId: args.candidate.anyharnessWorkspaceId,
        provider: args.candidate.provider,
        owner: args.candidate.owner,
        repoName: args.candidate.repoName,
        branch: status.currentBranch ?? null,
        headSha: status.headOid,
        clean: status.clean,
        conflicted: status.conflicted,
        detached: status.detached,
        operationInProgress: status.operation !== "none",
        alreadyLinkedCloudWorkspaceId: args.alreadyLinkedCloudWorkspaceId,
      };
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not read the local workspace status.");
      return false;
    }

    const verification = verifyLinkCandidate(proof, args.cloudTarget);
    if (!verification.linkable) {
      // Truthful blocker; NEVER fall through to materialization (PR5-LINK-01).
      showToast(verification.blocker);
      return false;
    }

    try {
      const intent = await createIntent({
        workspaceId: args.cloudTarget.cloudWorkspaceId,
        body: { targetKind: "local_desktop", desktopInstallId },
      });
      await report({
        workspaceId: args.cloudTarget.cloudWorkspaceId,
        materializationId: intent.materialization.id,
        body: {
          generation: intent.materialization.generation,
          state: "hydrated",
          anyharnessWorkspaceId: args.candidate.anyharnessWorkspaceId,
          worktreePath: args.candidate.worktreePath,
          observedBranch: proof.branch,
          observedHeadSha: proof.headSha,
        },
      });
      const runtimeUrl = runtime.runtimeUrl?.trim() ?? "";
      if (runtimeUrl) {
        await invalidateWorkspaceCollectionsForRuntime(runtimeUrl);
      }
      await selectWorkspace(args.candidate.anyharnessWorkspaceId, { force: true });
      showToast("Linked this Mac's copy to the Cloud workspace.", "info");
      return true;
    } catch (error) {
      if (isStaleMaterializationGenerationError(error)) {
        const runtimeUrl = runtime.runtimeUrl?.trim() ?? "";
        if (runtimeUrl) {
          await invalidateWorkspaceCollectionsForRuntime(runtimeUrl);
        }
        showToast("This workspace's link was updated elsewhere; nothing to do here.", "info");
        return true;
      }
      showToast(error instanceof Error ? error.message : "Could not link these copies.");
      return false;
    }
  }, [
    createIntent,
    desktopInstallId,
    invalidateWorkspaceCollectionsForRuntime,
    report,
    runtime,
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
      // The materialization's worktreePath is the local AnyHarness workspace's
      // own worktree, NOT the shared repo root that hosts many worktrees
      // (PR5-PATH-06).
      const worktreePath = status.workspacePath;
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
    linkCopies,
    addCloudCopy,
    unlinkThisMac,
    desktopInstallId,
  };
}
