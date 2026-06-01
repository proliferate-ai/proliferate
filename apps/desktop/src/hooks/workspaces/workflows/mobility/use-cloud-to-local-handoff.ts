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
import type { WorkspaceMobilityConfirmSnapshot } from "@/lib/domain/workspaces/mobility/types";
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
import { withRequiredWorkspaceMobilitySourceMetadata } from "@/lib/domain/workspaces/mobility/mobility-handoff-eligibility";
import { elapsedMs, logLatency, startLatencyTimer } from "@/lib/infra/measurement/debug-latency";
import { resolveHandoffFinalizationAfterAmbiguousCutover } from "@/lib/access/cloud/workspace-mobility-handoff";
import {
  runCloudToLocalHandoff,
  type RunCloudToLocalHandoffDeps,
} from "@/lib/workflows/workspaces/mobility/run-cloud-to-local-handoff";

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
      const sourcePreflight = withRequiredWorkspaceMobilitySourceMetadata(
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

  const handoffDeps = useMemo<RunCloudToLocalHandoffDeps>(() => ({
    startHandoff: (input) => startHandoff.mutateAsync(input),
    prepareDestination: (input) => prepareDestination.mutateAsync(input),
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
    purgePreparedDestination: (workspaceId) => purgePreparedDestination.mutateAsync(workspaceId),
    invalidateWorkspaceCollections,
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

  const confirm = useCallback(async (snapshot: WorkspaceMobilityConfirmSnapshot) => {
    clearMcpNotice(snapshot.logicalWorkspaceId);
    clearConfirmSnapshot(snapshot.logicalWorkspaceId);
    setIsRunning(true);
    try {
      await runCloudToLocalHandoff({
        snapshot,
        repoRootId: args.logicalWorkspace?.repoRoot?.id ?? null,
        preferredWorkspaceName: args.logicalWorkspace?.displayName ?? undefined,
        previousCloudWorkspaceId: args.logicalWorkspace?.cloudWorkspace?.id
          ?? args.logicalWorkspace?.mobilityWorkspace?.cloudWorkspaceId
          ?? null,
      }, handoffDeps);
    } finally {
      setIsRunning(false);
    }
  }, [
    args.logicalWorkspace?.cloudWorkspace?.id,
    args.logicalWorkspace?.displayName,
    args.logicalWorkspace?.mobilityWorkspace?.cloudWorkspaceId,
    args.logicalWorkspace?.repoRoot?.id,
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
