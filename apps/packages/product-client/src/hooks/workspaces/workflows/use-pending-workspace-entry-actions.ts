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

// The cloud workspace stack is deleted for good; every cloud unavailability
// surface reads the same permanent message.
const CLOUD_WORKSPACE_UNAVAILABLE_MESSAGE = "Cloud workspaces are no longer available.";

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
  const { selectWorkspace, clearWorkspaceRuntimeState } = useWorkspaceSelection();
  const materializePendingWorkspaceSessions = usePendingWorkspaceSessionMaterialization();

  /**
   * End one attempt: its registry entry and the launch intent that owns it.
   *
   * Dismissal and retry both need this. Retry needs it because the replacement
   * mints a fresh attempt id, so without it the failed attempt keeps its
   * sidebar row — with plural rows that row is a corpse nothing ever collects
   * (PRO-230 review finding 2).
   */
  const endAttempt = useCallback((entry: PendingWorkspaceEntry) => {
    clearPendingWorkspaceEntry(entry.attemptId);
    const linkedIntent = launchIntentForAttempt(
      useChatLaunchIntentStore.getState(),
      entry.attemptId,
    );
    if (linkedIntent) {
      useChatLaunchIntentStore.getState().clear(linkedIntent.id);
    }
  }, [clearPendingWorkspaceEntry]);

  const handleRetry = useCallback(async (entry: PendingWorkspaceEntry) => {
    switch (entry.request.kind) {
      // The three create retries start the replacement first and end the failed
      // attempt second: every create registers its new pending entry in its
      // synchronous prefix, so by the time the old row goes the new one is
      // already there and the sidebar swaps rather than blinks.
      case "local": {
        const replacement = createLocalWorkspaceAndEnter(entry.request.sourceRoot);
        endAttempt(entry);
        await replacement;
        return;
      }
      case "worktree": {
        const replacement = createWorktreeAndEnter(
          resolvePendingWorktreeRetryInput(entry.request),
          {
            latencyFlowId: startLatencyFlow({
              flowKind: "worktree_enter",
              source: "retry",
              attemptId: entry.attemptId,
              targetWorkspaceId: entry.workspaceId,
            }),
          },
        );
        endAttempt(entry);
        await replacement;
        return;
      }
      case "cloud": {
        // The cloud sandbox stack is deleted, so a stale cloud attempt can
        // only be ended — toast + end, reading exactly like the cowork
        // "not wired up" case above.
        showToast(CLOUD_WORKSPACE_UNAVAILABLE_MESSAGE);
        endAttempt(entry);
        return;
      }
      case "cowork":
        // Cowork retry isn't wired up yet — start a fresh thread from the
        // cowork sidebar. Ending the attempt sends the user back.
        showToast("Start a new cowork thread from the sidebar.", "info");
        endAttempt(entry);
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
    endAttempt,
    materializePendingWorkspaceSessions,
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
    endAttempt(entry);
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
    clearWorkspaceRuntimeState,
    clearDeferredLaunchesForWorkspace,
    endAttempt,
    navigate,
    selectWorkspace,
    showToast,
  ]);

  return {
    handleRetry,
    handleBack,
  };
}
