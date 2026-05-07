import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { resetWorkspaceEditorState } from "@/stores/editor/workspace-editor-state";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { buildWorkspaceArrivalEvent } from "@/lib/domain/workspaces/creation/arrival";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";
import type { PendingWorkspaceEntry } from "@/lib/domain/workspaces/creation/pending-entry";
import { useCreateCloudWorkspace } from "@/hooks/cloud/use-create-cloud-workspace";
import { useWorkspaceEntryActions } from "@/hooks/workspaces/use-workspace-entry-actions";
import { useWorkspaceSelection } from "@/hooks/workspaces/selection/use-workspace-selection";
import { useWorkspaces } from "@/hooks/workspaces/use-workspaces";
import { useToastStore } from "@/stores/toast/toast-store";
import { useDeferredHomeLaunchStore } from "@/stores/home/deferred-home-launch-store";
import {
  failLatencyFlow,
  startLatencyFlow,
} from "@/lib/infra/measurement/latency-flow";

export function usePendingWorkspaceEntryActions() {
  const navigate = useNavigate();
  const showToast = useToastStore((state) => state.show);
  const setPendingWorkspaceEntry = useSessionSelectionStore(
    (state) => state.setPendingWorkspaceEntry,
  );
  const setWorkspaceArrivalEvent = useSessionSelectionStore(
    (state) => state.setWorkspaceArrivalEvent,
  );
  const clearDeferredLaunchesForWorkspace = useDeferredHomeLaunchStore((state) =>
    state.clearForWorkspace
  );
  const { data: workspaceCollections } = useWorkspaces();
  const {
    createLocalWorkspaceAndEnter,
    createWorktreeAndEnter,
  } = useWorkspaceEntryActions();
  const { retryCloudWorkspaceAndEnter } = useCreateCloudWorkspace();
  const { selectWorkspace, clearWorkspaceRuntimeState } = useWorkspaceSelection();

  const handleRetry = useCallback(async (entry: PendingWorkspaceEntry) => {
    switch (entry.request.kind) {
      case "local":
        await createLocalWorkspaceAndEnter(entry.request.sourceRoot);
        return;
      case "worktree":
        await createWorktreeAndEnter(entry.request.input, {
          latencyFlowId: startLatencyFlow({
            flowKind: "worktree_enter",
            source: "retry",
            attemptId: entry.attemptId,
            targetWorkspaceId: entry.workspaceId,
          }),
        });
        return;
      case "cloud":
        await retryCloudWorkspaceAndEnter(entry.request.input);
        return;
      case "cowork":
        // Cowork retry isn't wired up yet — start a fresh thread from the
        // cowork sidebar. Clearing the pending entry sends the user back.
        showToast("Start a new cowork thread from the sidebar.", "info");
        setPendingWorkspaceEntry(null);
        return;
      case "select-existing":
        {
          const latencyFlowId = startLatencyFlow({
            flowKind: "workspace_switch",
            source: "retry",
            attemptId: entry.attemptId,
            targetWorkspaceId: entry.request.workspaceId,
          });
          setPendingWorkspaceEntry({
            ...entry,
            stage: "submitting",
            errorMessage: null,
          });
          try {
            await selectWorkspace(entry.request.workspaceId, {
              force: true,
              preservePending: true,
              latencyFlowId,
            });

            const cloudWorkspaceId = parseCloudWorkspaceSyntheticId(entry.request.workspaceId);
            const cloudWorkspace = cloudWorkspaceId
              ? workspaceCollections?.cloudWorkspaces.find((workspace) => workspace.id === cloudWorkspaceId)
              : null;
            const current = useSessionSelectionStore.getState().pendingWorkspaceEntry;
            if (!current || current.attemptId !== entry.attemptId) {
              return;
            }
            if (cloudWorkspaceId && cloudWorkspace?.status !== "ready") {
              setPendingWorkspaceEntry({
                ...current,
                stage: "awaiting-cloud-ready",
                errorMessage: null,
              });
              return;
            }
            setPendingWorkspaceEntry(null);
            setWorkspaceArrivalEvent(buildWorkspaceArrivalEvent({
              workspaceId: entry.request.workspaceId,
              source: current.source,
              setupScript: current.setupScript,
              baseBranchName: current.baseBranchName,
            }));
          } catch (error) {
            failLatencyFlow(latencyFlowId, "workspace_switch_failed");
            setPendingWorkspaceEntry({
              ...entry,
              stage: "failed",
              errorMessage: error instanceof Error ? error.message : "Failed to reconnect workspace.",
            });
          }
        }
    }
  }, [
    createLocalWorkspaceAndEnter,
    createWorktreeAndEnter,
    retryCloudWorkspaceAndEnter,
    selectWorkspace,
    setPendingWorkspaceEntry,
    setWorkspaceArrivalEvent,
    workspaceCollections,
  ]);

  const handleBack = useCallback(async (entry: PendingWorkspaceEntry) => {
    if (entry.workspaceId) {
      clearDeferredLaunchesForWorkspace(entry.workspaceId);
    }
    if (entry.originTarget.kind === "home") {
      const selectedWorkspaceId = useSessionSelectionStore.getState().selectedWorkspaceId;
      if (selectedWorkspaceId) {
        clearWorkspaceRuntimeState(selectedWorkspaceId, { clearSelection: true });
      } else {
        setPendingWorkspaceEntry(null);
        resetWorkspaceEditorState();
      }
      navigate("/");
      return;
    }

    try {
      await selectWorkspace(entry.originTarget.workspaceId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to return to previous workspace.";
      showToast(message);
    }
  }, [
    clearWorkspaceRuntimeState,
    clearDeferredLaunchesForWorkspace,
    navigate,
    selectWorkspace,
    setPendingWorkspaceEntry,
    showToast,
  ]);

  return {
    handleRetry,
    handleBack,
  };
}
