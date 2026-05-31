import { useEffect, useRef } from "react";
import {
  useDestroyWorkspaceMobilitySourceMutation,
  useUpdateWorkspaceMobilityRuntimeStateMutation,
} from "@anyharness/sdk-react";
import { getCloudWorkspace } from "@proliferate/cloud-sdk/client/workspaces";
import { useCompleteCloudWorkspaceHandoffCleanup } from "@/hooks/access/cloud/use-complete-cloud-workspace-handoff-cleanup";
import { useFailCloudWorkspaceHandoff } from "@/hooks/access/cloud/use-fail-cloud-workspace-handoff";
import { useCloudWorkspaceHandoffHeartbeatLoop } from "@/hooks/workspaces/mobility/use-cloud-workspace-handoff-heartbeat-loop";
import { useWorkspaceMobilityCache } from "@/hooks/workspaces/cache/use-workspace-mobility-cache";
import { useWorkspaceSelection } from "@/hooks/workspaces/selection/use-workspace-selection";
import { describeCloudWorkspaceNotReadyFailure } from "@/hooks/workspaces/mobility/use-cloud-workspace-readiness-waiter";
import { isWorkspaceMobilityTransitionPhase } from "@/lib/domain/workspaces/mobility/mobility-state-machine";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { useToastStore } from "@/stores/toast/toast-store";
import { useWorkspaceMobilityUiStore } from "@/stores/workspaces/workspace-mobility-ui-store";
import { useWorkspaceMobilityState } from "./use-workspace-mobility-state";
import type { CloudWorkspaceDetail } from "@/lib/access/cloud/client";

const DESTINATION_ERROR_POLL_MS = 5_000;
const DESTINATION_MISSING_GRACE_MS = 120_000;

export function describeDestinationWorkspaceHandoffFailure(
  workspace: CloudWorkspaceDetail | null | undefined,
  options: { elapsedMs: number },
): string | null {
  if (!workspace) {
    return options.elapsedMs >= DESTINATION_MISSING_GRACE_MS
      ? "Cloud workspace not found."
      : null;
  }
  return describeCloudWorkspaceNotReadyFailure(workspace);
}

export function useWorkspaceMobilityLifecycle() {
  const state = useWorkspaceMobilityState();
  const runtimeUrl = useHarnessConnectionStore((store) => store.runtimeUrl);
  const completeCleanup = useCompleteCloudWorkspaceHandoffCleanup();
  const failHandoff = useFailCloudWorkspaceHandoff();
  const cleanupWorkspace = useDestroyWorkspaceMobilitySourceMutation();
  const updateRuntimeState = useUpdateWorkspaceMobilityRuntimeStateMutation();
  const { clearWorkspaceRuntimeState } = useWorkspaceSelection();
  const { invalidateWorkspaceCollections } = useWorkspaceMobilityCache(runtimeUrl);
  const showToast = useToastStore((store) => store.show);
  const showMcpNotice = useWorkspaceMobilityUiStore((store) => store.showMcpNotice);
  const handledDestinationErrorRef = useRef<string | null>(null);
  const completedFinalizedCleanupRef = useRef<string | null>(null);
  const restoredFailedSourceRef = useRef<string | null>(null);

  const activeHandoff = state.mobilityWorkspaceDetail?.activeHandoff
    ?? state.selectedLogicalWorkspace?.mobilityWorkspace?.activeHandoff
    ?? null;
  const destinationCloudWorkspaceId = state.mobilityWorkspaceDetail?.cloudWorkspaceId
    ?? state.selectedLogicalWorkspace?.mobilityWorkspace?.cloudWorkspaceId
    ?? null;

  useCloudWorkspaceHandoffHeartbeatLoop({
    mobilityWorkspaceId: state.mobilityWorkspaceId,
    handoffOpId: activeHandoff?.id ?? null,
    enabled: isWorkspaceMobilityTransitionPhase(state.status.phase),
  });

  useEffect(() => {
    if (
      !activeHandoff
      || activeHandoff.direction !== "local_to_cloud"
      || !state.mobilityWorkspaceId
      || !destinationCloudWorkspaceId
      || !isWorkspaceMobilityTransitionPhase(state.status.phase)
    ) {
      return;
    }

    let cancelled = false;
    let timer: number | null = null;
    let inFlight = false;
    const startedAt = Date.now();

    const recoverFromDestinationFailure = async (failureMessage: string) => {
      const recoveryKey = `${activeHandoff.id}:${failureMessage}`;
      if (handledDestinationErrorRef.current === recoveryKey) {
        return;
      }
      handledDestinationErrorRef.current = recoveryKey;

      await Promise.all([
        failHandoff.mutateAsync({
          mobilityWorkspaceId: state.mobilityWorkspaceId ?? "",
          handoffOpId: activeHandoff.id,
          input: {
            failureCode: "destination_workspace_failed",
            failureDetail: failureMessage,
          },
        }).catch(() => undefined),
        state.localWorkspaceId
          ? updateRuntimeState.mutateAsync({
            workspaceId: state.localWorkspaceId,
            input: {
              mode: "normal",
              handoffOpId: null,
            },
          }).catch(() => undefined)
          : Promise.resolve(),
      ]);

      await invalidateWorkspaceCollections().catch(() => undefined);
      if (!cancelled) {
        showToast(failureMessage);
      }
    };

    const pollDestination = async () => {
      if (cancelled || inFlight) {
        return;
      }

      inFlight = true;
      try {
        const workspace = await getCloudWorkspace(destinationCloudWorkspaceId);
        const failureMessage = describeDestinationWorkspaceHandoffFailure(workspace, {
          elapsedMs: Date.now() - startedAt,
        });
        if (failureMessage) {
          await recoverFromDestinationFailure(failureMessage);
          return;
        }
      } catch {
        // Cloud detail and mobility queries remain the visible source of truth.
      } finally {
        inFlight = false;
      }

      if (!cancelled) {
        timer = window.setTimeout(() => {
          void pollDestination();
        }, DESTINATION_ERROR_POLL_MS);
      }
    };

    void pollDestination();

    return () => {
      cancelled = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [
    activeHandoff,
    destinationCloudWorkspaceId,
    failHandoff,
    invalidateWorkspaceCollections,
    showToast,
    state.localWorkspaceId,
    state.mobilityWorkspaceId,
    state.status.phase,
    updateRuntimeState,
  ]);

  useEffect(() => {
    if (
      !activeHandoff
      || activeHandoff.phase !== "cleanup_pending"
      || !activeHandoff.finalizedAt
      || activeHandoff.cleanupCompletedAt
      || !state.mobilityWorkspaceId
    ) {
      return;
    }
    const localSourceCleanupWorkspaceId = activeHandoff.direction === "local_to_cloud"
      ? state.localWorkspaceId
      : null;
    if (activeHandoff.direction === "local_to_cloud" && !localSourceCleanupWorkspaceId) {
      return;
    }

    const recoveryKey = `${state.mobilityWorkspaceId}:${activeHandoff.id}`;
    if (completedFinalizedCleanupRef.current === recoveryKey) {
      return;
    }
    completedFinalizedCleanupRef.current = recoveryKey;

    void (async () => {
      try {
        if (localSourceCleanupWorkspaceId) {
          await cleanupWorkspace.mutateAsync({
            workspaceId: localSourceCleanupWorkspaceId,
          });
          clearWorkspaceRuntimeState(localSourceCleanupWorkspaceId);
        }
        await completeCleanup.mutateAsync({
          mobilityWorkspaceId: state.mobilityWorkspaceId ?? "",
          handoffOpId: activeHandoff.id,
        });
        if (state.selectedLogicalWorkspaceId) {
          showMcpNotice(state.selectedLogicalWorkspaceId);
        }
      } catch (error) {
        showToast(
          error instanceof Error
            ? error.message
            : "Workspace cleanup still needs retry.",
        );
      } finally {
        await invalidateWorkspaceCollections().catch(() => undefined);
      }
    })();
  }, [
    activeHandoff,
    cleanupWorkspace,
    clearWorkspaceRuntimeState,
    completeCleanup,
    invalidateWorkspaceCollections,
    showMcpNotice,
    showToast,
    state.localWorkspaceId,
    state.mobilityWorkspaceId,
    state.selectedLogicalWorkspaceId,
  ]);

  useEffect(() => {
    const logicalWorkspace = state.selectedLogicalWorkspace;
    const locallyOwnedMobilityWorkspace = Boolean(
      logicalWorkspace?.mobilityWorkspace
      && logicalWorkspace.effectiveOwner === "local"
      && !activeHandoff
      && (
        logicalWorkspace.lifecycle === "local_active"
        || logicalWorkspace.lifecycle === "handoff_failed"
        || logicalWorkspace.lifecycle === "cleanup_failed"
        || logicalWorkspace.lifecycle === "repair_required"
      ),
    );
    if (
      !state.localWorkspaceId
      || !locallyOwnedMobilityWorkspace
    ) {
      return;
    }

    const recoveryKey = `${state.localWorkspaceId}:${logicalWorkspace?.mobilityWorkspace?.id ?? ""}`;
    if (restoredFailedSourceRef.current === recoveryKey) {
      return;
    }
    restoredFailedSourceRef.current = recoveryKey;

    void (async () => {
      await updateRuntimeState.mutateAsync({
        workspaceId: state.localWorkspaceId,
        input: {
          mode: "normal",
          handoffOpId: null,
        },
      }).catch(() => undefined);
      await invalidateWorkspaceCollections().catch(() => undefined);
    })();
  }, [
    invalidateWorkspaceCollections,
    activeHandoff,
    state.localWorkspaceId,
    state.selectedLogicalWorkspace,
    updateRuntimeState,
  ]);
}
