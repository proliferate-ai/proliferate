import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useWorkspaceFilesStore } from "@/stores/editor/workspace-files-store";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { buildWorkspaceArrivalEvent } from "@/lib/domain/workspaces/arrival";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud-ids";
import type { PendingWorkspaceEntry } from "@/lib/domain/workspaces/pending-entry";
import { useWorkspaceEntryActions } from "@/hooks/workspaces/use-workspace-entry-actions";
import { useWorkspaceSelection } from "@/hooks/workspaces/selection/use-workspace-selection";
import { useWorkspaces } from "@/hooks/workspaces/use-workspaces";
import { useToastStore } from "@/stores/toast/toast-store";
import {
  failLatencyFlow,
  startLatencyFlow,
} from "@/lib/infra/latency-flow";

export function usePendingWorkspaceEntryActions() {
  const navigate = useNavigate();
  const showToast = useToastStore((state) => state.show);
  const setPendingWorkspaceEntry = useHarnessStore(
    (state) => state.setPendingWorkspaceEntry,
  );
  const setWorkspaceArrivalEvent = useHarnessStore(
    (state) => state.setWorkspaceArrivalEvent,
  );
  const { data: workspaceCollections } = useWorkspaces();
  const {
    createLocalWorkspaceAndEnter,
    createWorktreeAndEnter,
    createCloudWorkspaceAndEnter,
  } = useWorkspaceEntryActions();
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
        await createCloudWorkspaceAndEnter(entry.request.input);
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
            const current = useHarnessStore.getState().pendingWorkspaceEntry;
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
    createCloudWorkspaceAndEnter,
    createLocalWorkspaceAndEnter,
    createWorktreeAndEnter,
    selectWorkspace,
    setPendingWorkspaceEntry,
    setWorkspaceArrivalEvent,
    workspaceCollections,
  ]);

  const handleBack = useCallback(async (entry: PendingWorkspaceEntry) => {
    if (entry.originTarget.kind === "home") {
      const selectedWorkspaceId = useHarnessStore.getState().selectedWorkspaceId;
      if (selectedWorkspaceId) {
        clearWorkspaceRuntimeState(selectedWorkspaceId, { clearSelection: true });
      } else {
        setPendingWorkspaceEntry(null);
        useWorkspaceFilesStore.getState().reset();
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
