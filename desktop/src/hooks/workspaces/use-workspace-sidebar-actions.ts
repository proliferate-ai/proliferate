import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useToastStore } from "@/stores/toast/toast-store";
import { useWorkspaceFilesStore } from "@/stores/editor/workspace-files-store";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useAppSurfaceStore } from "@/stores/ui/app-surface-store";
import { useWorkspaceEntryActions } from "./use-workspace-entry-actions";
import { useWorkspaceSelection } from "./selection/use-workspace-selection";
import { useAddRepo } from "./use-add-repo";
import {
  failLatencyFlow,
  startLatencyFlow,
} from "@/lib/infra/latency-flow";

export function useWorkspaceSidebarActions() {
  const navigate = useNavigate();
  const setPendingWorkspaceEntry = useHarnessStore((state) => state.setPendingWorkspaceEntry);
  const pendingWorkspaceEntry = useHarnessStore((state) => state.pendingWorkspaceEntry);
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const pendingCoworkThread = useAppSurfaceStore((state) => state.pendingCoworkThread);
  const setPendingCoworkThread = useAppSurfaceStore((state) => state.setPendingCoworkThread);
  const { selectWorkspace, clearWorkspaceRuntimeState } = useWorkspaceSelection();
  const {
    createLocalWorkspaceAndEnter,
    createWorktreeAndEnter,
    isCreatingWorktreeWorkspace,
  } = useWorkspaceEntryActions();
  const { addRepoFromPicker } = useAddRepo();
  const showToast = useToastStore((state) => state.show);

  const handleAddRepo = useCallback(() => {
    void addRepoFromPicker();
  }, [addRepoFromPicker]);

  const handleGoHome = useCallback(() => {
    if (selectedWorkspaceId) {
      clearWorkspaceRuntimeState(selectedWorkspaceId, { clearSelection: true });
    } else if (pendingWorkspaceEntry) {
      setPendingWorkspaceEntry(null);
      useWorkspaceFilesStore.getState().reset();
    } else if (pendingCoworkThread) {
      setPendingCoworkThread(null);
    }
    navigate("/");
  }, [
    clearWorkspaceRuntimeState,
    navigate,
    pendingCoworkThread,
    pendingWorkspaceEntry,
    setPendingCoworkThread,
    setPendingWorkspaceEntry,
    selectedWorkspaceId,
  ]);

  const handleSelectWorkspace = useCallback((workspaceId: string) => {
    const latencyFlowId = startLatencyFlow({
      flowKind: "workspace_switch",
      source: "sidebar",
      targetWorkspaceId: workspaceId,
    });
    void selectWorkspace(workspaceId, { latencyFlowId }).catch((error) => {
      failLatencyFlow(latencyFlowId, "workspace_switch_failed");
      const message = error instanceof Error ? error.message : String(error);
      showToast(`Failed to select workspace: ${message}`);
    });
  }, [selectWorkspace, showToast]);

  const handleCreateLocalWorkspace = useCallback((sourceRoot: string | null) => {
    if (!sourceRoot) {
      return;
    }

    // Use lightweight path when already in a workspace (sidebar creation)
    // to avoid disrupting the current workspace with a pending shell.
    const lightweight = !!selectedWorkspaceId;
    void createLocalWorkspaceAndEnter(sourceRoot, { lightweight }).catch((error) => {
      if (lightweight) {
        const message = error instanceof Error ? error.message : "Failed to create workspace.";
        showToast(message);
      }
    });
  }, [createLocalWorkspaceAndEnter, selectedWorkspaceId, showToast]);

  const handleCreateWorktreeWorkspace = useCallback((repoWorkspaceId: string | null) => {
    if (!repoWorkspaceId || isCreatingWorktreeWorkspace) {
      return;
    }

    // Use lightweight path when already in a workspace (sidebar creation)
    // to avoid disrupting the current workspace with a pending shell.
    const lightweight = !!selectedWorkspaceId;
    const latencyFlowId = startLatencyFlow({
      flowKind: "worktree_enter",
      source: "sidebar",
      targetWorkspaceId: repoWorkspaceId,
    });
    void createWorktreeAndEnter(repoWorkspaceId, {
      lightweight,
      latencyFlowId,
    }).catch((error) => {
      failLatencyFlow(latencyFlowId, "worktree_enter_failed");
      if (lightweight) {
        const message = error instanceof Error ? error.message : "Failed to create worktree.";
        showToast(message);
      }
    });
  }, [createWorktreeAndEnter, isCreatingWorktreeWorkspace, selectedWorkspaceId, showToast]);

  return {
    handleAddRepo,
    handleGoHome,
    handleSelectWorkspace,
    handleCreateLocalWorkspace,
    handleCreateWorktreeWorkspace,
  };
}
