import {
  useDestroyWorkspaceMobilitySourceMutation,
  useExportWorkspaceMobilityArchiveMutation,
  useInstallWorkspaceMobilityArchiveMutation,
  useUpdateWorkspaceMobilityRuntimeStateMutation,
  useWorkspaceMobilityPreflightQuery,
} from "@anyharness/sdk-react";
import { useCallback, useMemo, useState } from "react";
import type { WorkspaceMobilityConfirmSnapshot } from "@/lib/domain/workspaces/mobility/types";
import { retryCloudWorkspaceRequest } from "@/lib/access/cloud/workspace-connection-retry";
import {
  getCloudMobilityWorkspaceHandoffDetail,
  resolveHandoffFinalizationAfterAmbiguousCutover,
} from "@/lib/access/cloud/workspace-mobility-handoff";
import { useWorkspaceMobilityCache } from "@/hooks/workspaces/cache/use-workspace-mobility-cache";
import { useCloudWorkspaceHandoffPreflight } from "@/hooks/access/cloud/use-cloud-workspace-handoff-preflight";
import { useCompleteCloudWorkspaceHandoffCleanup } from "@/hooks/access/cloud/use-complete-cloud-workspace-handoff-cleanup";
import { useEnsureCloudMobilityWorkspace } from "@/hooks/access/cloud/use-ensure-cloud-mobility-workspace";
import { useFailCloudWorkspaceHandoff } from "@/hooks/access/cloud/use-fail-cloud-workspace-handoff";
import { useFinalizeCloudWorkspaceHandoff } from "@/hooks/access/cloud/use-finalize-cloud-workspace-handoff";
import { useStartCloudWorkspaceHandoff } from "@/hooks/access/cloud/use-start-cloud-workspace-handoff";
import { useUpdateCloudWorkspaceHandoffPhase } from "@/hooks/access/cloud/use-update-cloud-workspace-handoff-phase";
import { useWorkspaceSelection } from "@/hooks/workspaces/workflows/selection/use-workspace-selection";
import { useCloudWorkspaceReadinessWaiter } from "@/hooks/workspaces/workflows/mobility/use-cloud-workspace-readiness-waiter";
import { useWorkspaceMobilityUiStore } from "@/stores/workspaces/workspace-mobility-ui-store";
import { useToastStore } from "@/stores/toast/toast-store";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import type { LogicalWorkspace } from "@/lib/domain/workspaces/cloud/logical-workspace-model";
import { describeMobilityPreflightLoadFailure } from "@/lib/domain/workspaces/mobility/mobility-preflight-error";
import { withRequiredWorkspaceMobilitySourceMetadata } from "@/lib/domain/workspaces/mobility/mobility-handoff-eligibility";
import { elapsedMs, logLatency, startLatencyTimer } from "@/lib/infra/measurement/debug-latency";
import {
  runLocalToCloudHandoff,
  type RunLocalToCloudHandoffDeps,
} from "@/lib/workflows/workspaces/mobility/run-local-to-cloud-handoff";

export function useLocalToCloudHandoff(args: {
  logicalWorkspace: LogicalWorkspace | null;
  logicalWorkspaceId: string | null;
  localWorkspaceId: string | null;
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

  const prepare = useCallback(async (requestId?: number) => {
    if (!canPrepare || !args.logicalWorkspace || !args.logicalWorkspaceId || !args.localWorkspaceId) {
      showToast("This workspace cannot be moved to cloud yet.");
      return;
    }

    const prepareStartedAt = startLatencyTimer();
    logLatency("mobility.prepare.local_to_cloud.start", {
      requestId,
      logicalWorkspaceId: args.logicalWorkspaceId,
      workspaceId: args.localWorkspaceId,
    });

    try {
      const ensureStartedAt = startLatencyTimer();
      const ensured = await ensureMobilityWorkspace.mutateAsync({
        gitProvider: args.logicalWorkspace.provider!,
        gitOwner: args.logicalWorkspace.owner!,
        gitRepoName: args.logicalWorkspace.repoName!,
        gitBranch: args.logicalWorkspace.branchKey,
        displayName: args.logicalWorkspace.displayName,
        ownerHint: "local",
      });
      logLatency("mobility.prepare.local_to_cloud.ensure.complete", {
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
      const sourcePreflight = withRequiredWorkspaceMobilitySourceMetadata(
        sourcePreflightData,
        args.logicalWorkspace.branchKey,
      );
      logLatency("mobility.prepare.local_to_cloud.source_preflight.complete", {
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
          direction: "local_to_cloud",
          requestedBranch: sourcePreflight.branchName ?? args.logicalWorkspace.branchKey,
          requestedBaseSha: sourcePreflight.baseCommitSha ?? null,
        },
      });
      logLatency("mobility.prepare.local_to_cloud.cloud_preflight.complete", {
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
          logLatency("mobility.prepare.local_to_cloud.aborted", {
            requestId,
            logicalWorkspaceId: args.logicalWorkspaceId,
            elapsedMs: elapsedMs(prepareStartedAt),
          });
          return;
        }
      }

      setConfirmSnapshot({
        logicalWorkspaceId: args.logicalWorkspaceId,
        direction: "local_to_cloud",
        sourceWorkspaceId: args.localWorkspaceId,
        mobilityWorkspaceId: ensured.id,
        sourcePreflight,
        cloudPreflight: cloudPreflightResult,
      });
      logLatency("mobility.prepare.local_to_cloud.complete", {
        requestId,
        logicalWorkspaceId: args.logicalWorkspaceId,
        mobilityWorkspaceId: ensured.id,
        elapsedMs: elapsedMs(prepareStartedAt),
      });
    } catch (error) {
      logLatency("mobility.prepare.local_to_cloud.failed", {
        requestId,
        logicalWorkspaceId: args.logicalWorkspaceId,
        elapsedMs: elapsedMs(prepareStartedAt),
        error: error instanceof Error ? error.message : "unknown_error",
      });
      throw error;
    }
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

  const handoffDeps = useMemo<RunLocalToCloudHandoffDeps>(() => ({
    startHandoff: (input) => startHandoff.mutateAsync(input),
    loadCloudMobilityWorkspaceDetail: (mobilityWorkspaceId) =>
      retryCloudWorkspaceRequest(
        () => getCloudMobilityWorkspaceHandoffDetail(mobilityWorkspaceId),
        "Failed to load cloud destination after starting the move.",
      ),
    waitForCloudWorkspaceReady,
    invalidateWorkspaceCollections,
    updateRuntimeState: (input) => updateRuntimeState.mutateAsync(input),
    updatePhase: (input) => updatePhase.mutateAsync(input),
    exportArchive: (input) => exportArchive.mutateAsync(input),
    installArchive: (input) => installArchive.mutateAsync(input),
    finalizeHandoff: (input) => finalizeHandoff.mutateAsync(input),
    clearWorkspaceOwnerFlipCache,
    clearWorkspaceRuntimeState,
    refreshWorkspaceCollections,
    selectWorkspace,
    showMcpNotice,
    cleanupWorkspace: (input) => cleanupWorkspace.mutateAsync(input),
    completeCleanup: (input) => completeCleanup.mutateAsync(input),
    failHandoff: (input) => failHandoff.mutateAsync(input),
    resolveFinalizationAfterAmbiguousCutover: resolveHandoffFinalizationAfterAmbiguousCutover,
    showToast,
  }), [
    cleanupWorkspace,
    clearWorkspaceOwnerFlipCache,
    clearWorkspaceRuntimeState,
    completeCleanup,
    exportArchive,
    failHandoff,
    finalizeHandoff,
    installArchive,
    invalidateWorkspaceCollections,
    refreshWorkspaceCollections,
    selectWorkspace,
    showMcpNotice,
    showToast,
    startHandoff,
    updatePhase,
    updateRuntimeState,
    waitForCloudWorkspaceReady,
  ]);

  const confirm = useCallback(async (snapshot: WorkspaceMobilityConfirmSnapshot) => {
    clearMcpNotice(snapshot.logicalWorkspaceId);
    clearConfirmSnapshot(snapshot.logicalWorkspaceId);
    setIsRunning(true);
    try {
      await runLocalToCloudHandoff({
        snapshot,
      }, handoffDeps);
    } finally {
      setIsRunning(false);
    }
  }, [
    clearConfirmSnapshot,
    clearMcpNotice,
    handoffDeps,
  ]);

  return {
    canPrepare,
    isPending,
    prepare,
    confirm,
  };
}
