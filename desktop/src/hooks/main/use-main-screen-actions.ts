import { useCallback } from "react";
import { useRenameGitBranchMutation } from "@anyharness/sdk-react";
import { useQueryClient } from "@tanstack/react-query";
import { useWorkspaceRuntimeBlock } from "@/hooks/workspaces/use-workspace-runtime-block";
import { openExternal } from "@/platform/tauri/shell";
import { updateCloudWorkspaceBranch } from "@/lib/integrations/cloud/workspaces";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud-ids";
import { workspaceCollectionsScopeKey } from "@/hooks/workspaces/query-keys";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useToastStore } from "@/stores/toast/toast-store";
import { useLogicalWorkspaceStore } from "@/stores/workspaces/logical-workspace-store";
import type { RightPanelMode } from "@/components/workspace/shell/right-panel/RightPanel";
import type {
  MainScreenDataState,
  MainScreenLayoutState,
} from "./use-main-screen-state";
import {
  CLOSED_PUBLISH_DIALOG_STATE,
  openPublishDialogState,
  reviewDiffsFromPublishState,
} from "./publish-dialog-state";

interface UseMainScreenActionsArgs {
  layout: MainScreenLayoutState;
  existingPr: MainScreenDataState["existingPr"];
}

export function useMainScreenActions({
  layout,
  existingPr,
}: UseMainScreenActionsArgs) {
  const queryClient = useQueryClient();
  const renameBranchMutation = useRenameGitBranchMutation();
  const runtimeUrl = useHarnessStore((state) => state.runtimeUrl);
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const selectedLogicalWorkspaceId = useLogicalWorkspaceStore((state) => state.selectedLogicalWorkspaceId);
  const { getWorkspaceRuntimeBlockReason } = useWorkspaceRuntimeBlock();
  const showToast = useToastStore((state) => state.show);
  const {
    rightPanelOpen,
    setRightPanelMode,
    setSidebarOpen,
    setRightPanelOpen,
    setTerminalCollapsed,
    setTerminalFocusRequestToken,
    setFilePaletteOpen,
    setPublishDialog,
  } = layout;

  const openRightPanelMode = useCallback((mode: RightPanelMode) => {
    setRightPanelMode(mode);
    setRightPanelOpen(true);
  }, [setRightPanelMode, setRightPanelOpen]);

  const openTerminalPanel = useCallback(() => {
    if (!selectedWorkspaceId) {
      return false;
    }

    setRightPanelOpen(true);
    setTerminalCollapsed(false);
    setTerminalFocusRequestToken((token) => token + 1);
    return true;
  }, [
    selectedWorkspaceId,
    setRightPanelOpen,
    setTerminalCollapsed,
    setTerminalFocusRequestToken,
  ]);

  const toggleRightPanel = useCallback(() => {
    if (rightPanelOpen) {
      setRightPanelOpen(false);
    } else {
      openRightPanelMode("changes");
    }
  }, [openRightPanelMode, rightPanelOpen, setRightPanelOpen]);

  const openPrInBrowser = useCallback((pullRequest?: MainScreenDataState["existingPr"]) => {
    const url = pullRequest?.url ?? existingPr?.url;
    if (url) {
      void openExternal(url);
    }
  }, [existingPr]);

  const handleFilePaletteOpen = useCallback(() => {
    setFilePaletteOpen(true);
  }, [setFilePaletteOpen]);

  const handleViewPr = useCallback((pullRequest?: MainScreenDataState["existingPr"]) => {
    openPrInBrowser(pullRequest);
  }, [openPrInBrowser]);

  const openPublishDialog = useCallback((intent: "commit" | "publish" | "pull_request") => {
    setPublishDialog(openPublishDialogState(
      selectedLogicalWorkspaceId ?? selectedWorkspaceId,
      intent,
    ));
  }, [selectedLogicalWorkspaceId, selectedWorkspaceId, setPublishDialog]);

  const closePublishDialog = useCallback(() => {
    setPublishDialog(CLOSED_PUBLISH_DIALOG_STATE);
  }, [setPublishDialog]);

  const reviewDiffsFromPublish = useCallback(() => {
    const next = reviewDiffsFromPublishState();
    setPublishDialog(next.publishDialog);
    setRightPanelMode(next.rightPanelMode);
    setRightPanelOpen(next.rightPanelOpen);
  }, [setPublishDialog, setRightPanelMode, setRightPanelOpen]);

  const renameBranch = useCallback(async (newName: string) => {
    const blockedReason = getWorkspaceRuntimeBlockReason(selectedWorkspaceId);
    if (blockedReason) {
      showToast(blockedReason);
      return;
    }
    await renameBranchMutation.mutateAsync(newName);
    const cloudWorkspaceId = parseCloudWorkspaceSyntheticId(selectedWorkspaceId);
    if (cloudWorkspaceId) {
      await updateCloudWorkspaceBranch(cloudWorkspaceId, newName).catch(() => undefined);
    }
    await queryClient.invalidateQueries({
      queryKey: workspaceCollectionsScopeKey(runtimeUrl),
    });
  }, [
    queryClient,
    renameBranchMutation,
    runtimeUrl,
    getWorkspaceRuntimeBlockReason,
    selectedWorkspaceId,
    showToast,
  ]);

  return {
    renameBranch,
    onToggleSidebar: () => setSidebarOpen((value) => !value),
    toggleRightPanel,
    openTerminalPanel,
    onSetRightPanelMode: setRightPanelMode,
    handleCommitOpen: () => openPublishDialog("commit"),
    handlePushOpen: () => openPublishDialog("publish"),
    handlePrOpen: () => openPublishDialog("pull_request"),
    handleFilePaletteOpen,
    handleViewPr,
    closePublishDialog,
    reviewDiffsFromPublish,
    onFilePaletteClose: () => setFilePaletteOpen(false),
  };
}
