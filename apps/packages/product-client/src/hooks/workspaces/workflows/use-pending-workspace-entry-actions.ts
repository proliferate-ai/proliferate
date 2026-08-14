import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { resetWorkspaceEditorState } from "#product/stores/editor/workspace-editor-state";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { buildWorkspaceArrivalEvent } from "#product/lib/domain/workspaces/creation/arrival";
import { parseCloudWorkspaceSyntheticId } from "#product/lib/domain/workspaces/cloud/cloud-ids";
import { resolveCloudWorkspaceStatus } from "#product/lib/domain/workspaces/cloud/cloud-workspace-status";
import {
  type PendingWorkspaceEntry,
  resolvePendingWorktreeRetryInput,
} from "#product/lib/domain/workspaces/creation/pending-entry";
import { useCreateCloudWorkspace } from "#product/hooks/cloud/workflows/use-create-cloud-workspace";
import { useWorkspaceEntryActions } from "#product/hooks/workspaces/workflows/use-workspace-entry-actions";
import { useWorkspaceSelection } from "#product/hooks/workspaces/workflows/selection/use-workspace-selection";
import { useWorkspaces } from "#product/hooks/workspaces/cache/use-workspaces";
import {
  usePendingWorkspaceSessionMaterialization,
} from "#product/hooks/workspaces/workflows/use-pending-workspace-session-materialization";
import {
  resolveActiveProjectedSessionForPendingWorkspace,
} from "#product/hooks/workspaces/workflows/pending-workspace-projected-session";
import {
  getPendingWorkspaceEntry,
} from "#product/hooks/workspaces/workflows/pending-workspace-attempt-access";
import {
  launchIntentForAttempt,
} from "#product/lib/domain/chat/launch/launch-intent-registry";
import { useChatLaunchIntentStore } from "#product/stores/chat/chat-launch-intent-store";
import { useToastStore } from "#product/stores/toast/toast-store";
import { useDeferredHomeLaunchStore } from "#product/stores/home/deferred-home-launch-store";
import {
  failLatencyFlow,
  startLatencyFlow,
} from "#product/lib/infra/measurement/measurement-port";

export function usePendingWorkspaceEntryActions() {
  const navigate = useNavigate();
  const showToast = useToastStore((state) => state.show);
  const setPendingWorkspaceEntry = useSessionSelectionStore(
    (state) => state.setPendingWorkspaceEntry,
  );
  const clearPendingWorkspaceEntry = useSessionSelectionStore(
    (state) => state.clearPendingWorkspaceEntry,
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
  const materializePendingWorkspaceSessions = usePendingWorkspaceSessionMaterialization();

  const handleRetry = useCallback(async (entry: PendingWorkspaceEntry) => {
    switch (entry.request.kind) {
      case "local":
        await createLocalWorkspaceAndEnter(entry.request.sourceRoot);
        return;
      case "worktree":
        await createWorktreeAndEnter(resolvePendingWorktreeRetryInput(entry.request), {
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
        clearPendingWorkspaceEntry(entry.attemptId);
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
            const initialActiveSessionId = resolveActiveProjectedSessionForPendingWorkspace(
              entry.request.workspaceId,
              getPendingWorkspaceEntry(entry.attemptId),
            );
            await selectWorkspace(entry.request.workspaceId, {
              force: true,
              preservePending: true,
              ...(initialActiveSessionId ? { initialActiveSessionId } : {}),
              latencyFlowId,
            });

            const cloudWorkspaceId = parseCloudWorkspaceSyntheticId(entry.request.workspaceId);
            const cloudWorkspace = cloudWorkspaceId
              ? workspaceCollections?.cloudWorkspaces.find((workspace) => workspace.id === cloudWorkspaceId)
              : null;
            const current = getPendingWorkspaceEntry(entry.attemptId);
            if (!current) {
              return;
            }
            if (cloudWorkspaceId && resolveCloudWorkspaceStatus(cloudWorkspace) !== "ready") {
              setPendingWorkspaceEntry({
                ...current,
                stage: "awaiting-cloud-ready",
                errorMessage: null,
              });
              return;
            }
            materializePendingWorkspaceSessions(current, entry.request.workspaceId, {
              eventPrefix: "workspace.entry.retry",
            });
            clearPendingWorkspaceEntry(entry.attemptId);
            setWorkspaceArrivalEvent(buildWorkspaceArrivalEvent({
              workspaceId: entry.request.workspaceId,
              source: current.source,
              receiptClientSessionId: initialActiveSessionId,
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
    clearPendingWorkspaceEntry,
    createLocalWorkspaceAndEnter,
    createWorktreeAndEnter,
    materializePendingWorkspaceSessions,
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
    // Back is the explicit dismissal: selection no longer drops the entry, so
    // this is what ends the attempt. It ends exactly one attempt — the entry
    // and the launch intent that owns it — and leaves every other launch in
    // flight (PRO-230).
    clearPendingWorkspaceEntry(entry.attemptId);
    const linkedIntent = launchIntentForAttempt(
      useChatLaunchIntentStore.getState(),
      entry.attemptId,
    );
    if (linkedIntent) {
      useChatLaunchIntentStore.getState().clear(linkedIntent.id);
    }
    if (entry.originTarget.kind === "home") {
      const selectedWorkspaceId = useSessionSelectionStore.getState().selectedWorkspaceId;
      if (selectedWorkspaceId) {
        clearWorkspaceRuntimeState(selectedWorkspaceId, { clearSelection: true });
      } else {
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
    clearPendingWorkspaceEntry,
    clearWorkspaceRuntimeState,
    clearDeferredLaunchesForWorkspace,
    navigate,
    selectWorkspace,
    showToast,
  ]);

  return {
    handleRetry,
    handleBack,
  };
}
