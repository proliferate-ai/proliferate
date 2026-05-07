import { useCallback } from "react";
import { useRenameGitBranchMutation } from "@anyharness/sdk-react";
import { useQueryClient } from "@tanstack/react-query";
import { useWorkspaceRuntimeBlock } from "@/hooks/workspaces/use-workspace-runtime-block";
import { openExternal } from "@/platform/tauri/shell";
import { updateCloudWorkspaceBranch } from "@/lib/access/cloud/workspaces";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";
import { workspaceCollectionsScopeKey } from "@/hooks/workspaces/query-keys";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useToastStore } from "@/stores/toast/toast-store";
import {
  parseRightPanelHeaderEntryKey,
  rightPanelTerminalHeaderKey,
  rightPanelToolHeaderKey,
  type RightPanelTool,
} from "@/lib/domain/workspaces/shell/right-panel";
import type {
  MainScreenDataState,
  MainScreenLayoutState,
} from "./use-main-screen-state";
import {
  CLOSED_PUBLISH_DIALOG_STATE,
  openPublishDialogState,
} from "./publish-dialog-state";
import type { PublishIntent } from "@/lib/domain/workspaces/creation/publish-workflow";

interface UseMainScreenActionsArgs {
  layout: MainScreenLayoutState;
  existingPr: MainScreenDataState["existingPr"];
}

export function useMainScreenActions({
  layout,
  existingPr,
}: UseMainScreenActionsArgs) {
  const queryClient = useQueryClient();
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const renameBranchMutation = useRenameGitBranchMutation({ workspaceId: selectedWorkspaceId });
  const { getWorkspaceRuntimeBlockReason } = useWorkspaceRuntimeBlock();
  const showToast = useToastStore((state) => state.show);
  const {
    rightPanelOpen,
    rightPanelState,
    setRightPanelState,
    setSidebarOpen,
    setRightPanelOpen,
    requestRightPanelFocus,
    setTerminalActivationRequest,
    setCommandPaletteOpen,
    setPublishDialog,
  } = layout;

  const openRightPanelTool = useCallback((tool: RightPanelTool) => {
    setRightPanelState((previous) => ({
      ...previous,
      activeEntryKey: rightPanelToolHeaderKey(tool),
    }));
    setRightPanelOpen(true);
    requestRightPanelFocus();
  }, [requestRightPanelFocus, setRightPanelOpen, setRightPanelState]);

  const openTerminalPanel = useCallback((terminalId?: string) => {
    if (!selectedWorkspaceId) {
      return false;
    }

    if (terminalId) {
      const terminalKey = rightPanelTerminalHeaderKey(terminalId);
      setRightPanelState((previous) => ({
        ...previous,
        headerOrder: previous.headerOrder.includes(terminalKey)
          ? previous.headerOrder
          : [...previous.headerOrder, terminalKey],
        activeEntryKey: terminalKey,
      }));
      setRightPanelOpen(true);
      setTerminalActivationRequest((request) => ({
        token: (request?.token ?? 0) + 1,
        workspaceId: selectedWorkspaceId,
      }));
      return true;
    }

    setRightPanelOpen(true);
    setTerminalActivationRequest((request) => ({
      token: (request?.token ?? 0) + 1,
      workspaceId: selectedWorkspaceId,
    }));
    return true;
  }, [
    selectedWorkspaceId,
    setRightPanelOpen,
    setRightPanelState,
    setTerminalActivationRequest,
  ]);

  const toggleRightPanel = useCallback(() => {
    if (rightPanelOpen) {
      setRightPanelOpen(false);
    } else {
      const activeEntry = parseRightPanelHeaderEntryKey(rightPanelState.activeEntryKey);
      if (activeEntry?.kind === "browser" || activeEntry?.kind === "terminal") {
        setRightPanelOpen(true);
        requestRightPanelFocus();
        return;
      }
      openRightPanelTool("files");
    }
  }, [
    openRightPanelTool,
    requestRightPanelFocus,
    rightPanelOpen,
    rightPanelState.activeEntryKey,
    setRightPanelOpen,
  ]);

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
