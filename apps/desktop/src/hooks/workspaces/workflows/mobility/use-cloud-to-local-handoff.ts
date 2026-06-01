import {
  useDestroyWorkspaceMobilitySourceMutation,
  useExportWorkspaceMobilityArchiveMutation,
  useInstallWorkspaceMobilityArchiveMutation,
  usePrepareRepoRootMobilityDestinationMutation,
  usePurgeWorkspaceMutation,
  useUpdateWorkspaceMobilityRuntimeStateMutation,
  useWorkspaceMobilityPreflightQuery,
} from "@anyharness/sdk-react";
import { useCallback, useMemo, useState } from "react";
import type { WorkspaceMobilityPreflightResponse } from "@anyharness/sdk";
import { useCloudWorkspaceHandoffPreflight } from "@/hooks/access/cloud/use-cloud-workspace-handoff-preflight";
import { useCompleteCloudWorkspaceHandoffCleanup } from "@/hooks/access/cloud/use-complete-cloud-workspace-handoff-cleanup";
import { useEnsureCloudMobilityWorkspace } from "@/hooks/access/cloud/use-ensure-cloud-mobility-workspace";
import { useFailCloudWorkspaceHandoff } from "@/hooks/access/cloud/use-fail-cloud-workspace-handoff";
import { useFinalizeCloudWorkspaceHandoff } from "@/hooks/access/cloud/use-finalize-cloud-workspace-handoff";
import { useStartCloudWorkspaceHandoff } from "@/hooks/access/cloud/use-start-cloud-workspace-handoff";
import { useUpdateCloudWorkspaceHandoffPhase } from "@/hooks/access/cloud/use-update-cloud-workspace-handoff-phase";
import { useWorkspaceSelection } from "@/hooks/workspaces/workflows/selection/use-workspace-selection";
import { useWorkspaceMobilityCache } from "@/hooks/workspaces/cache/use-workspace-mobility-cache";
import { useWorkspaceMobilityUiStore } from "@/stores/workspaces/workspace-mobility-ui-store";
import { useToastStore } from "@/stores/toast/toast-store";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import type { LogicalWorkspace } from "@/lib/domain/workspaces/cloud/logical-workspace-model";
import { describeMobilityPreflightLoadFailure } from "@/lib/domain/workspaces/mobility/mobility-preflight-error";
import { elapsedMs, logLatency, startLatencyTimer } from "@/lib/infra/measurement/debug-latency";
import {
  deriveHandoffFailureRecovery,
  resolveHandoffFinalizationAfterAmbiguousCutover,
} from "./handoff-failure-recovery";

function withRequiredSourceMetadata(
  preflight: WorkspaceMobilityPreflightResponse,
  fallbackBranch: string,
): WorkspaceMobilityPreflightResponse {
  const blockers = [...(preflight.blockers ?? [])];
  if (!preflight.branchName?.trim()) {
    blockers.push({
      code: "missing_branch_name",
      message: "Workspace mobility requires a resolved branch name.",
      sessionId: undefined,
    });
  }
  if (!preflight.baseCommitSha?.trim()) {
    blockers.push({
      code: "missing_base_commit_sha",
      message: "Workspace mobility requires a resolved base commit.",
      sessionId: undefined,
    });
  }

  return {
    ...preflight,
    branchName: preflight.branchName?.trim() || fallbackBranch,
    blockers,
    canMove: preflight.canMove && blockers.length === 0,
  };
}

export function useCloudToLocalHandoff(args: {
  logicalWorkspace: LogicalWorkspace | null;
  logicalWorkspaceId: string | null;
  cloudMaterializationId: string | null;
  mobilityWorkspaceId: string | null;
}) {
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const setConfirmSnapshot = useWorkspaceMobilityUiStore((state) => state.setConfirmSnapshot);
  const clearConfirmSnapshot = useWorkspaceMobilityUiStore((state) => state.clearConfirmSnapshot);
  const showMcpNotice = useWorkspaceMobilityUiStore((state) => state.showMcpNotice);
  const clearMcpNotice = useWorkspaceMobilityUiStore((state) => state.clearMcpNotice);
  const showToast = useToastStore((state) => state.show);
  const { selectWorkspace, clearWorkspaceRuntimeState } = useWorkspaceSelection();
  const { clearWorkspaceOwnerFlipCache, invalidateWorkspaceCollections, refreshWorkspaceCollections } =
    useWorkspaceMobilityCache(runtimeUrl);
  const ensureMobilityWorkspace = useEnsureCloudMobilityWorkspace();
  const cloudPreflight = useCloudWorkspaceHandoffPreflight();
  const startHandoff = useStartCloudWorkspaceHandoff();
  const updatePhase = useUpdateCloudWorkspaceHandoffPhase();
  const finalizeHandoff = useFinalizeCloudWorkspaceHandoff();
  const failHandoff = useFailCloudWorkspaceHandoff();
  const completeCleanup = useCompleteCloudWorkspaceHandoffCleanup();
  const prepareDestination = usePrepareRepoRootMobilityDestinationMutation();
  const updateRuntimeState = useUpdateWorkspaceMobilityRuntimeStateMutation();
  const exportArchive = useExportWorkspaceMobilityArchiveMutation();
  const installArchive = useInstallWorkspaceMobilityArchiveMutation();
  const cleanupWorkspace = useDestroyWorkspaceMobilitySourceMutation();
  const purgePreparedDestination = usePurgeWorkspaceMutation();
  const sourcePreflightQuery = useWorkspaceMobilityPreflightQuery({
    workspaceId: args.cloudMaterializationId,
    enabled: false,
  });
  const [isRunning, setIsRunning] = useState(false);
  const isPending = isRunning
    || ensureMobilityWorkspace.isPending
    || cloudPreflight.isPending
    || startHandoff.isPending
    || updatePhase.isPending
    || finalizeHandoff.isPending
    || failHandoff.isPending
    || completeCleanup.isPending
    || prepareDestination.isPending
    || updateRuntimeState.isPending
    || exportArchive.isPending
    || installArchive.isPending
    || cleanupWorkspace.isPending
    || purgePreparedDestination.isPending;

  const canPrepare = useMemo(() => Boolean(
    args.logicalWorkspace
    && args.logicalWorkspaceId
    && args.cloudMaterializationId
    && args.logicalWorkspace.repoRoot?.id
    && args.logicalWorkspace.provider
    && args.logicalWorkspace.owner
    && args.logicalWorkspace.repoName,
  ), [args.cloudMaterializationId, args.logicalWorkspace, args.logicalWorkspaceId]);

  const prepare = useCallback(async (requestId?: number) => {
    if (!canPrepare || !args.logicalWorkspace || !args.logicalWorkspaceId || !args.cloudMaterializationId) {
      showToast("This workspace cannot be brought back locally yet.");
      return;
    }

    const prepareStartedAt = startLatencyTimer();
    logLatency("mobility.prepare.cloud_to_local.start", {
      requestId,
      logicalWorkspaceId: args.logicalWorkspaceId,
      workspaceId: args.cloudMaterializationId,
    });

    try {
      const ensureStartedAt = startLatencyTimer();
      const ensured = await ensureMobilityWorkspace.mutateAsync({
        gitProvider: args.logicalWorkspace.provider!,
        gitOwner: args.logicalWorkspace.owner!,
        gitRepoName: args.logicalWorkspace.repoName!,
        gitBranch: args.logicalWorkspace.branchKey,
        displayName: args.logicalWorkspace.displayName,
        ownerHint: "cloud",
      });
      logLatency("mobility.prepare.cloud_to_local.ensure.complete", {
        requestId,
        logicalWorkspaceId: args.logicalWorkspaceId,
        mobilityWorkspaceId: ensured.id,
        elapsedMs: elapsedMs(ensureStartedAt),
      });

      const sourcePreflightStartedAt = startLatencyTimer();
      const sourcePreflightResult = await sourcePreflightQuery.refetch();
      const sourcePreflightData = sourcePreflightResult.data;
      if (!sourcePreflightData) {
        throw new Error(describeMobilityPreflightLoadFailure({
          error: sourcePreflightResult.error,
          status: sourcePreflightResult.status,
          fetchStatus: sourcePreflightResult.fetchStatus,
        }));
      }
      const sourcePreflight = withRequiredSourceMetadata(
        sourcePreflightData,
        args.logicalWorkspace.branchKey,
      );
      logLatency("mobility.prepare.cloud_to_local.source_preflight.complete", {
        requestId,
        logicalWorkspaceId: args.logicalWorkspaceId,
        canMove: sourcePreflight.canMove,
        blockerCount: sourcePreflight.blockers?.length ?? 0,
        sessionCount: sourcePreflight.sessions?.length ?? 0,
        elapsedMs: elapsedMs(sourcePreflightStartedAt),
      });

      const cloudPreflightStartedAt = startLatencyTimer();
      const cloudPreflightResult = await cloudPreflight.mutateAsync({
        mobilityWorkspaceId: ensured.id,
        input: {
          direction: "cloud_to_local",
          requestedBranch: sourcePreflight.branchName ?? args.logicalWorkspace.branchKey,
          requestedBaseSha: sourcePreflight.baseCommitSha ?? null,
        },
      });
      logLatency("mobility.prepare.cloud_to_local.cloud_preflight.complete", {
        requestId,
        logicalWorkspaceId: args.logicalWorkspaceId,
        mobilityWorkspaceId: ensured.id,
        canStart: cloudPreflightResult.canStart,
        blockerCount: cloudPreflightResult.blockers?.length ?? 0,
        excludedPathCount: cloudPreflightResult.excludedPaths?.length ?? 0,
        elapsedMs: elapsedMs(cloudPreflightStartedAt),
      });

      if (requestId !== undefined) {
        const activeRequestId = useWorkspaceMobilityUiStore.getState()
          .activePromptRequestIdByLogicalWorkspaceId[args.logicalWorkspaceId];
        if (activeRequestId !== requestId) {
          logLatency("mobility.prepare.cloud_to_local.aborted", {
            requestId,
            logicalWorkspaceId: args.logicalWorkspaceId,
            elapsedMs: elapsedMs(prepareStartedAt),
          });
          return;
        }
      }

      setConfirmSnapshot({
        logicalWorkspaceId: args.logicalWorkspaceId,
        direction: "cloud_to_local",
        sourceWorkspaceId: args.cloudMaterializationId,
        mobilityWorkspaceId: ensured.id,
        sourcePreflight,
        cloudPreflight: cloudPreflightResult,
      });
      logLatency("mobility.prepare.cloud_to_local.complete", {
        requestId,
        logicalWorkspaceId: args.logicalWorkspaceId,
        mobilityWorkspaceId: ensured.id,
        elapsedMs: elapsedMs(prepareStartedAt),
      });
    } catch (error) {
      logLatency("mobility.prepare.cloud_to_local.failed", {
        requestId,
        logicalWorkspaceId: args.logicalWorkspaceId,
        elapsedMs: elapsedMs(prepareStartedAt),
        error: error instanceof Error ? error.message : "unknown_error",
      });
      throw error;
    }
  }, [
    args.cloudMaterializationId,
    args.logicalWorkspace,
    args.logicalWorkspaceId,
    canPrepare,
    cloudPreflight,
    ensureMobilityWorkspace,
    setConfirmSnapshot,
    showToast,
    sourcePreflightQuery,
  ]);

  const confirm = useCallback(async (snapshot: {
    logicalWorkspaceId: string;
    mobilityWorkspaceId: string;
    sourceWorkspaceId: string;
    sourcePreflight: WorkspaceMobilityPreflightResponse;
  }) => {
    const branchName = snapshot.sourcePreflight.branchName?.trim();
    const baseCommitSha = snapshot.sourcePreflight.baseCommitSha?.trim();
    const repoRootId = args.logicalWorkspace?.repoRoot?.id ?? null;
    if (!branchName || !baseCommitSha || !repoRootId) {
      showToast("Workspace mobility requires a local repo root, branch, and base commit.");
      return;
    }

    let handoffOpId: string | null = null;
      let destinationWorkspaceId: string | null = null;
      let destinationCreatedForHandoff = false;
      let finalized = false;
      let cleanupCompleted = false;
      let sourceRemoteOwned = false;

    clearMcpNotice(snapshot.logicalWorkspaceId);
    clearConfirmSnapshot(snapshot.logicalWorkspaceId);
    setIsRunning(true);

    try {
      const handoff = await startHandoff.mutateAsync({
        mobilityWorkspaceId: snapshot.mobilityWorkspaceId,
        input: {
          direction: "cloud_to_local",
          requestedBranch: branchName,
          requestedBaseSha: baseCommitSha,
          excludePaths: [],
        },
      });
      handoffOpId = handoff.id;

      const destination = await prepareDestination.mutateAsync({
        repoRootId,
        input: {
          requestedBranch: branchName,
          requestedBaseSha: baseCommitSha,
          preferredWorkspaceName: args.logicalWorkspace?.displayName ?? undefined,
        },
      });
      destinationWorkspaceId = destination.workspace.id;
      destinationCreatedForHandoff = destination.created;

      await updateRuntimeState.mutateAsync({
        workspaceId: snapshot.sourceWorkspaceId,
        input: {
          mode: "frozen_for_handoff",
          handoffOpId,
        },
      });
      await updatePhase.mutateAsync({
        mobilityWorkspaceId: snapshot.mobilityWorkspaceId,
        handoffOpId,
        input: {
          phase: "source_frozen",
          statusDetail: "Cloud source frozen",
        },
      });

      await updatePhase.mutateAsync({
        mobilityWorkspaceId: snapshot.mobilityWorkspaceId,
        handoffOpId,
        input: {
          phase: "destination_ready",
          statusDetail: "Local destination ready",
        },
      });

      const archive = await exportArchive.mutateAsync({
        workspaceId: snapshot.sourceWorkspaceId,
        input: {
          excludePaths: [],
          expectedHandoffOpId: handoffOpId,
          expectedBaseCommitSha: baseCommitSha,
          expectedBranchName: branchName,
          requireCleanGitState: true,
        },
      });
      await installArchive.mutateAsync({
        workspaceId: destinationWorkspaceId,
        archive,
        operationId: handoffOpId,
      });

      await updatePhase.mutateAsync({
        mobilityWorkspaceId: snapshot.mobilityWorkspaceId,
        handoffOpId,
        input: {
          phase: "install_succeeded",
          statusDetail: "Archive installed locally",
        },
      });

      await updateRuntimeState.mutateAsync({
        workspaceId: snapshot.sourceWorkspaceId,
        input: {
          mode: "remote_owned",
          handoffOpId,
        },
      });
      sourceRemoteOwned = true;

      await finalizeHandoff.mutateAsync({
        mobilityWorkspaceId: snapshot.mobilityWorkspaceId,
        handoffOpId,
        input: {},
      });
      finalized = true;

      await clearWorkspaceOwnerFlipCache({
        logicalWorkspaceId: snapshot.logicalWorkspaceId,
        previousWorkspaceId: snapshot.sourceWorkspaceId,
        previousCloudWorkspaceId: args.logicalWorkspace?.cloudWorkspace?.id
          ?? args.logicalWorkspace?.mobilityWorkspace?.cloudWorkspaceId
          ?? null,
      });
      clearWorkspaceRuntimeState(snapshot.sourceWorkspaceId, { clearSelection: true });
      await refreshWorkspaceCollections();
      await selectWorkspace(destinationWorkspaceId, { force: true });

      showMcpNotice(snapshot.logicalWorkspaceId);
      void (async () => {
        try {
          await cleanupWorkspace.mutateAsync({
            workspaceId: snapshot.sourceWorkspaceId,
          });
          clearWorkspaceRuntimeState(snapshot.sourceWorkspaceId);
          await completeCleanup.mutateAsync({
            mobilityWorkspaceId: snapshot.mobilityWorkspaceId,
            handoffOpId,
          });
          cleanupCompleted = true;
          await invalidateWorkspaceCollections().catch(() => undefined);
        } catch (cleanupError) {
          if (cleanupCompleted) {
            await invalidateWorkspaceCollections().catch(() => undefined);
            return;
          }
          await failHandoff.mutateAsync({
            mobilityWorkspaceId: snapshot.mobilityWorkspaceId,
            handoffOpId,
            input: {
              failureCode: "cleanup_failed",
              failureDetail: cleanupError instanceof Error
                ? cleanupError.message
                : "Source cleanup failed after finalize.",
            },
          }).catch(() => undefined);
          await invalidateWorkspaceCollections().catch(() => undefined);
          showMcpNotice(snapshot.logicalWorkspaceId);
          showToast(cleanupError instanceof Error
            ? cleanupError.message
            : "The workspace moved, but source cleanup needs retry.");
        }
      })();
    } catch (error) {
      const finalizationResolution = !finalized && sourceRemoteOwned && handoffOpId
        ? await resolveHandoffFinalizationAfterAmbiguousCutover({
          mobilityWorkspaceId: snapshot.mobilityWorkspaceId,
          handoffOpId,
        })
        : "not_finalized";
      const effectiveFinalized = finalized || finalizationResolution === "finalized";
      const failureRecovery = deriveHandoffFailureRecovery({
        handoffStarted: handoffOpId !== null,
        finalized: effectiveFinalized,
        finalizationUnresolved: finalizationResolution === "unknown",
        cleanupCompleted,
      });

      if (handoffOpId && failureRecovery.shouldMarkHandoffFailed) {
        await failHandoff.mutateAsync({
          mobilityWorkspaceId: snapshot.mobilityWorkspaceId,
          handoffOpId,
          input: {
            failureCode: "handoff_failed",
            failureDetail: error instanceof Error
              ? error.message
              : "Workspace handoff failed.",
          },
        }).catch(() => undefined);
      }

      if (failureRecovery.shouldRestoreSourceRuntimeState) {
        await updateRuntimeState.mutateAsync({
          workspaceId: snapshot.sourceWorkspaceId,
          input: {
            mode: "normal",
            handoffOpId: null,
          },
        }).catch(() => undefined);
      }

      if (!effectiveFinalized && destinationWorkspaceId && destinationCreatedForHandoff) {
        await purgePreparedDestination.mutateAsync(destinationWorkspaceId).catch(() => undefined);
      }

      if (failureRecovery.shouldRefreshWorkspaceSelection) {
        await invalidateWorkspaceCollections();
        await selectWorkspace(snapshot.logicalWorkspaceId, { force: true }).catch(() => undefined);
      }

      showToast(error instanceof Error ? error.message : "Workspace handoff failed.");
      throw error;
    } finally {
      setIsRunning(false);
    }
  }, [
    args.logicalWorkspace,
    cleanupWorkspace,
    clearConfirmSnapshot,
    clearMcpNotice,
    clearWorkspaceOwnerFlipCache,
    clearWorkspaceRuntimeState,
    completeCleanup,
    exportArchive,
    failHandoff,
    finalizeHandoff,
    invalidateWorkspaceCollections,
    installArchive,
    prepareDestination,
    purgePreparedDestination,
    refreshWorkspaceCollections,
    selectWorkspace,
    showMcpNotice,
    showToast,
    startHandoff,
    updatePhase,
    updateRuntimeState,
  ]);

  return {
    canPrepare,
    isPending,
    prepare,
    confirm,
  };
}
