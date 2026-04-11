import {
  useDestroyWorkspaceMobilitySourceMutation,
  useExportWorkspaceMobilityArchiveMutation,
  useInstallWorkspaceMobilityArchiveMutation,
  useUpdateWorkspaceMobilityRuntimeStateMutation,
  useWorkspaceMobilityPreflightQuery,
} from "@anyharness/sdk-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import type { WorkspaceMobilityPreflightResponse } from "@anyharness/sdk";
import { workspaceCollectionsScopeKey } from "@/hooks/workspaces/query-keys";
import { getCloudMobilityWorkspaceDetail } from "@/lib/integrations/cloud/mobility";
import { cloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud-ids";
import { resetWorkspaceOwnerFlipState } from "@/hooks/workspaces/mobility/reset-workspace-owner-flip-state";
import { useCloudWorkspaceHandoffPreflight } from "@/hooks/cloud/use-cloud-workspace-handoff-preflight";
import { useCompleteCloudWorkspaceHandoffCleanup } from "@/hooks/cloud/use-complete-cloud-workspace-handoff-cleanup";
import { useEnsureCloudMobilityWorkspace } from "@/hooks/cloud/use-ensure-cloud-mobility-workspace";
import { useFailCloudWorkspaceHandoff } from "@/hooks/cloud/use-fail-cloud-workspace-handoff";
import { useFinalizeCloudWorkspaceHandoff } from "@/hooks/cloud/use-finalize-cloud-workspace-handoff";
import { useStartCloudWorkspaceHandoff } from "@/hooks/cloud/use-start-cloud-workspace-handoff";
import { useUpdateCloudWorkspaceHandoffPhase } from "@/hooks/cloud/use-update-cloud-workspace-handoff-phase";
import { useWorkspaceSelection } from "@/hooks/workspaces/selection/use-workspace-selection";
import { useCloudWorkspaceReadinessWaiter } from "@/hooks/workspaces/mobility/use-cloud-workspace-readiness-waiter";
import { useWorkspaceMobilityUiStore } from "@/stores/workspaces/workspace-mobility-ui-store";
import { useToastStore } from "@/stores/toast/toast-store";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import type { LogicalWorkspace } from "@/lib/domain/workspaces/logical-workspaces";
import { deriveHandoffFailureRecovery } from "./handoff-failure-recovery";

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

function supportedSessionIds(preflight: WorkspaceMobilityPreflightResponse): string[] {
  return (preflight.sessions ?? [])
    .filter((session) => session.supported)
    .map((session) => session.sessionId);
}

export function useLocalToCloudHandoff(args: {
  logicalWorkspace: LogicalWorkspace | null;
  logicalWorkspaceId: string | null;
  localWorkspaceId: string | null;
  mobilityWorkspaceId: string | null;
}) {
  const queryClient = useQueryClient();
  const runtimeUrl = useHarnessStore((state) => state.runtimeUrl);
  const setConfirmSnapshot = useWorkspaceMobilityUiStore((state) => state.setConfirmSnapshot);
  const clearConfirmSnapshot = useWorkspaceMobilityUiStore((state) => state.clearConfirmSnapshot);
  const showMcpNotice = useWorkspaceMobilityUiStore((state) => state.showMcpNotice);
  const clearMcpNotice = useWorkspaceMobilityUiStore((state) => state.clearMcpNotice);
  const showToast = useToastStore((state) => state.show);
  const { selectWorkspace, clearWorkspaceRuntimeState } = useWorkspaceSelection();
  const ensureMobilityWorkspace = useEnsureCloudMobilityWorkspace();
  const cloudPreflight = useCloudWorkspaceHandoffPreflight();
  const startHandoff = useStartCloudWorkspaceHandoff();
  const updatePhase = useUpdateCloudWorkspaceHandoffPhase();
  const finalizeHandoff = useFinalizeCloudWorkspaceHandoff();
  const failHandoff = useFailCloudWorkspaceHandoff();
  const completeCleanup = useCompleteCloudWorkspaceHandoffCleanup();
  const updateRuntimeState = useUpdateWorkspaceMobilityRuntimeStateMutation();
  const exportArchive = useExportWorkspaceMobilityArchiveMutation();
  const installArchive = useInstallWorkspaceMobilityArchiveMutation();
  const cleanupWorkspace = useDestroyWorkspaceMobilitySourceMutation();
  const waitForCloudWorkspaceReady = useCloudWorkspaceReadinessWaiter();
  const sourcePreflightQuery = useWorkspaceMobilityPreflightQuery({
    workspaceId: args.localWorkspaceId,
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
    || updateRuntimeState.isPending
    || exportArchive.isPending
    || installArchive.isPending
    || cleanupWorkspace.isPending;

  const canPrepare = useMemo(() => Boolean(
    args.logicalWorkspace
    && args.logicalWorkspaceId
    && args.localWorkspaceId
    && args.logicalWorkspace.provider
    && args.logicalWorkspace.owner
    && args.logicalWorkspace.repoName,
  ), [args.localWorkspaceId, args.logicalWorkspace, args.logicalWorkspaceId]);

  const prepare = useCallback(async () => {
    if (!canPrepare || !args.logicalWorkspace || !args.logicalWorkspaceId || !args.localWorkspaceId) {
      showToast("This workspace cannot be moved to cloud yet.");
      return;
    }

    const ensured = await ensureMobilityWorkspace.mutateAsync({
      gitProvider: args.logicalWorkspace.provider!,
      gitOwner: args.logicalWorkspace.owner!,
      gitRepoName: args.logicalWorkspace.repoName!,
      gitBranch: args.logicalWorkspace.branchKey,
      displayName: args.logicalWorkspace.displayName,
      ownerHint: "local",
    });

    const sourcePreflightResult = await sourcePreflightQuery.refetch();
    const sourcePreflightData = sourcePreflightResult.data;
    if (!sourcePreflightData) {
      throw new Error("Failed to load workspace mobility preflight.");
    }
    const sourcePreflight = withRequiredSourceMetadata(
      sourcePreflightData,
      args.logicalWorkspace.branchKey,
    );
    const cloudPreflightResult = await cloudPreflight.mutateAsync({
      mobilityWorkspaceId: ensured.id,
      input: {
        direction: "local_to_cloud",
        requestedBranch: sourcePreflight.branchName ?? args.logicalWorkspace.branchKey,
        requestedBaseSha: sourcePreflight.baseCommitSha ?? null,
      },
    });

    setConfirmSnapshot({
      logicalWorkspaceId: args.logicalWorkspaceId,
      direction: "local_to_cloud",
      sourceWorkspaceId: args.localWorkspaceId,
      mobilityWorkspaceId: ensured.id,
      sourcePreflight,
      cloudPreflight: cloudPreflightResult,
    });
  }, [
    args.localWorkspaceId,
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
    cloudPreflight: { excludedPaths: string[] };
  }) => {
    const branchName = snapshot.sourcePreflight.branchName?.trim();
    const baseCommitSha = snapshot.sourcePreflight.baseCommitSha?.trim();
    if (!branchName || !baseCommitSha) {
      showToast("Workspace mobility requires a resolved branch and base commit.");
      return;
    }

    let handoffOpId: string | null = null;
    let targetCloudWorkspaceId: string | null = null;
    let finalized = false;
    let cleanupCompleted = false;
    const movedSessionIds = supportedSessionIds(snapshot.sourcePreflight);

    clearMcpNotice(snapshot.logicalWorkspaceId);
    clearConfirmSnapshot(snapshot.logicalWorkspaceId);
    setIsRunning(true);

    try {
      const handoff = await startHandoff.mutateAsync({
        mobilityWorkspaceId: snapshot.mobilityWorkspaceId,
        input: {
          direction: "local_to_cloud",
          requestedBranch: branchName,
          requestedBaseSha: baseCommitSha,
          excludePaths: snapshot.cloudPreflight.excludedPaths,
        },
      });
      handoffOpId = handoff.id;

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
          statusDetail: "Source workspace frozen",
        },
      });

      const mobilityDetail = await getCloudMobilityWorkspaceDetail(snapshot.mobilityWorkspaceId);
      targetCloudWorkspaceId = mobilityDetail.cloudWorkspaceId ?? null;
      if (!targetCloudWorkspaceId) {
        throw new Error("Cloud destination did not resolve.");
      }

      await waitForCloudWorkspaceReady(targetCloudWorkspaceId);
      await queryClient.invalidateQueries({
        queryKey: workspaceCollectionsScopeKey(runtimeUrl),
      });

      await updatePhase.mutateAsync({
        mobilityWorkspaceId: snapshot.mobilityWorkspaceId,
        handoffOpId,
        input: {
          phase: "destination_ready",
          statusDetail: "Destination workspace ready",
          cloudWorkspaceId: targetCloudWorkspaceId,
        },
      });

      const archive = await exportArchive.mutateAsync({
        workspaceId: snapshot.sourceWorkspaceId,
        input: {
          excludePaths: snapshot.cloudPreflight.excludedPaths,
        },
      });
      const targetWorkspaceId = cloudWorkspaceSyntheticId(targetCloudWorkspaceId);
      await installArchive.mutateAsync({
        workspaceId: targetWorkspaceId,
        archive,
      });

      await updatePhase.mutateAsync({
        mobilityWorkspaceId: snapshot.mobilityWorkspaceId,
        handoffOpId,
        input: {
          phase: "install_succeeded",
          statusDetail: "Archive installed in cloud",
          cloudWorkspaceId: targetCloudWorkspaceId,
        },
      });

      await updateRuntimeState.mutateAsync({
        workspaceId: snapshot.sourceWorkspaceId,
        input: {
          mode: "remote_owned",
          handoffOpId,
        },
      });

      await finalizeHandoff.mutateAsync({
        mobilityWorkspaceId: snapshot.mobilityWorkspaceId,
        handoffOpId,
        input: {
          cloudWorkspaceId: targetCloudWorkspaceId,
        },
      });
      finalized = true;

      await resetWorkspaceOwnerFlipState({
        queryClient,
        runtimeUrl,
        logicalWorkspaceId: snapshot.logicalWorkspaceId,
        previousWorkspaceId: snapshot.sourceWorkspaceId,
        nextCloudWorkspaceId: targetCloudWorkspaceId,
        clearWorkspaceRuntimeState,
      });
      await selectWorkspace(snapshot.logicalWorkspaceId, { force: true });

      try {
        await cleanupWorkspace.mutateAsync({
          workspaceId: snapshot.sourceWorkspaceId,
        });
        await completeCleanup.mutateAsync({
          mobilityWorkspaceId: snapshot.mobilityWorkspaceId,
          handoffOpId,
        });
        await queryClient.invalidateQueries({
          queryKey: workspaceCollectionsScopeKey(runtimeUrl),
        });
        cleanupCompleted = true;
      } catch (cleanupError) {
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
        if (movedSessionIds.length > 0) {
          showMcpNotice(snapshot.logicalWorkspaceId);
        }
        throw cleanupError;
      }

      if (movedSessionIds.length > 0) {
        showMcpNotice(snapshot.logicalWorkspaceId);
      }
    } catch (error) {
      const failureRecovery = deriveHandoffFailureRecovery({
        handoffStarted: handoffOpId !== null,
        finalized,
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
        await queryClient.invalidateQueries({
          queryKey: workspaceCollectionsScopeKey(runtimeUrl),
        });
        await selectWorkspace(snapshot.logicalWorkspaceId, { force: true }).catch(() => undefined);
      }

      showToast(error instanceof Error ? error.message : "Workspace handoff failed.");
      throw error;
    } finally {
      setIsRunning(false);
    }
  }, [
    cleanupWorkspace,
    clearConfirmSnapshot,
    clearMcpNotice,
    clearWorkspaceRuntimeState,
    completeCleanup,
    exportArchive,
    failHandoff,
    finalizeHandoff,
    installArchive,
    queryClient,
    runtimeUrl,
    selectWorkspace,
    showMcpNotice,
    showToast,
    startHandoff,
    updatePhase,
    updateRuntimeState,
    waitForCloudWorkspaceReady,
  ]);

  return {
    canPrepare,
    isPending,
    prepare,
    confirm,
  };
}
