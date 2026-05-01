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
import {
  rightPanelTerminalHeaderKey,
  type RightPanelTool,
} from "@/lib/domain/workspaces/right-panel";
import type {
  MainScreenDataState,
  MainScreenLayoutState,
} from "./use-main-screen-state";
import {
  CLOSED_PUBLISH_DIALOG_STATE,
  openPublishDialogState,
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
  const runtimeUrl = useHarnessStore((state) => state.runtimeUrl);
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const renameBranchMutation = useRenameGitBranchMutation({ workspaceId: selectedWorkspaceId });
  const { getWorkspaceRuntimeBlockReason } = useWorkspaceRuntimeBlock();
  const showToast = useToastStore((state) => state.show);
  const {
    rightPanelOpen,
    rightPanelState,
    setRightPanelState,
    setSidebarOpen,
    setRightPanelOpen,
    setTerminalActivationRequestToken,
    setCommandPaletteOpen,
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

    if (terminalId) {
      const terminalKey = rightPanelTerminalHeaderKey(terminalId);
      setRightPanelState((previous) => ({
        ...previous,
        activeTool: "terminal",
        terminalOrder: previous.terminalOrder.includes(terminalId)
          ? previous.terminalOrder
          : [...previous.terminalOrder, terminalId],
        headerOrder: previous.headerOrder.includes(terminalKey)
          ? previous.headerOrder
          : [...previous.headerOrder, terminalKey],
        activeTerminalId: terminalId,
      }));
      setRightPanelOpen(true);
      setTerminalActivationRequestToken((token) => token + 1);
      return true;
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

  const handleCommandPaletteOpen = useCallback(() => {
    setCommandPaletteOpen(true);
  }, [setCommandPaletteOpen]);

  const handleViewPr = useCallback((pullRequest?: MainScreenDataState["existingPr"]) => {
    openRightPanelTool("git");
    openPrInBrowser(pullRequest);
  }, [openPrInBrowser, openRightPanelTool]);

  const handlePublishDialogViewPr = useCallback((pullRequest?: MainScreenDataState["existingPr"]) => {
    openPrInBrowser(pullRequest);
  }, [openPrInBrowser]);

  const openPublishDialog = useCallback((intent: PublishIntent) => {
    setPublishDialog(openPublishDialogState(
      selectedWorkspaceId,
      intent,
    ));
  }, [
    selectedWorkspaceId,
    setPublishDialog,
  ]);

  const closePublishDialog = useCallback(() => {
    setPublishDialog(CLOSED_PUBLISH_DIALOG_STATE);
  }, [setPublishDialog]);

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
    handleCommandPaletteOpen,
    handleViewPr,
    handlePublishDialogViewPr,
    closePublishDialog,
    onCommandPaletteClose: () => setCommandPaletteOpen(false),
  };
}
