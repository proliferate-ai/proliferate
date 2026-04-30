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
import type { RightPanelTool } from "@/lib/domain/workspaces/right-panel";
import type {
  MainScreenDataState,
  MainScreenLayoutState,
} from "./use-main-screen-state";
import {
  CLOSED_PUBLISH_DIALOG_STATE,
  openPublishDialogState,
  reviewDiffsFromPublishState,
} from "./publish-dialog-state";
import type { PublishIntent } from "@/lib/domain/workspaces/publish-workflow";

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
    rightPanelState,
    setRightPanelState,
    setSidebarOpen,
    setRightPanelOpen,
    setTerminalActivationRequestToken,
    setFilePaletteOpen,
    setPublishDialog,
  } = layout;

  const openRightPanelTool = useCallback((tool: RightPanelTool, terminalId?: string) => {
    setRightPanelState((previous) => ({
      ...previous,
      activeTool: tool,
      activeTerminalId: terminalId ?? previous.activeTerminalId,
    }));
    setRightPanelOpen(true);
  }, [setRightPanelOpen, setRightPanelState]);

  const openTerminalPanel = useCallback((terminalId?: string) => {
    if (!selectedWorkspaceId) {
      return false;
    }

    openRightPanelTool("terminal", terminalId);
    setTerminalActivationRequestToken((token) => token + 1);
    return true;
  }, [
    openRightPanelTool,
    selectedWorkspaceId,
    setTerminalActivationRequestToken,
  ]);

  const toggleRightPanel = useCallback(() => {
    if (rightPanelOpen) {
      setRightPanelOpen(false);
    } else {
      openRightPanelTool(rightPanelState.activeTool ?? "git");
    }
  }, [openRightPanelTool, rightPanelOpen, rightPanelState.activeTool, setRightPanelOpen]);

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
    openRightPanelTool("git");
    openPrInBrowser(pullRequest);
  }, [openPrInBrowser, openRightPanelTool]);

  const openPublishDialog = useCallback((intent: PublishIntent) => {
    openRightPanelTool("git");
    setPublishDialog(openPublishDialogState(
      selectedLogicalWorkspaceId ?? selectedWorkspaceId,
      intent,
    ));
  }, [
    openRightPanelTool,
    selectedLogicalWorkspaceId,
    selectedWorkspaceId,
    setPublishDialog,
  ]);

  const closePublishDialog = useCallback(() => {
    setPublishDialog(CLOSED_PUBLISH_DIALOG_STATE);
  }, [setPublishDialog]);

  const reviewDiffsFromPublish = useCallback(() => {
    const next = reviewDiffsFromPublishState();
    setPublishDialog(next.publishDialog);
    openRightPanelTool(next.rightPanelTool);
  }, [openRightPanelTool, setPublishDialog]);

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
    onSetRightPanelTool: openRightPanelTool,
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
