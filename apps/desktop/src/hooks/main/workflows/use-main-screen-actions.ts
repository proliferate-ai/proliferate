import { useCallback } from "react";
import { useRenameGitBranchMutation } from "@anyharness/sdk-react";
import { useWorkspaceRuntimeBlock } from "@/hooks/workspaces/derived/use-workspace-runtime-block";
import { useTauriShellActions } from "@/hooks/access/tauri/use-shell-actions";
import { updateCloudWorkspaceDisplayName } from "@proliferate/cloud-sdk/client/workspaces";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";
import { useWorkspaceCollectionsInvalidation } from "@/hooks/workspaces/cache/use-workspace-collections-invalidation";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useToastStore } from "@/stores/toast/toast-store";
import {
  parseRightPanelHeaderEntryKey,
  rightPanelTerminalHeaderKey,
  rightPanelToolHeaderKey,
  type RightPanelTool,
} from "@/lib/domain/workspaces/shell/right-panel-model";
import type {
  MainScreenDataState,
  MainScreenLayoutState,
} from "@/hooks/main/facade/use-main-screen-state";
import {
  CLOSED_PUBLISH_DIALOG_STATE,
  openPublishDialogState,
} from "@/lib/domain/workspaces/creation/publish-dialog-state";
import type { PublishIntent } from "@/lib/domain/workspaces/creation/publish-workflow-model";

interface UseMainScreenActionsArgs {
  layout: MainScreenLayoutState;
  existingPr: MainScreenDataState["existingPr"];
}

// Owns user-action callbacks for the Main workspace shell. It receives layout
// setters from the facade hook and delegates query cache writes to cache hooks.
export function useMainScreenActions({
  layout,
  existingPr,
}: UseMainScreenActionsArgs) {
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const invalidateWorkspaceCollections = useWorkspaceCollectionsInvalidation(runtimeUrl);
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const renameBranchMutation = useRenameGitBranchMutation({ workspaceId: selectedWorkspaceId });
  const { getWorkspaceRuntimeBlockReason } = useWorkspaceRuntimeBlock();
  const { openExternal } = useTauriShellActions();
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

  const openRightPanel = useCallback(() => {
    setRightPanelOpen(true);
    requestRightPanelFocus();
  }, [requestRightPanelFocus, setRightPanelOpen]);

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
      openRightPanelTool("scratch");
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
  }, [existingPr, openExternal]);

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
      await updateCloudWorkspaceDisplayName(cloudWorkspaceId, newName).catch(() => undefined);
    }
    await invalidateWorkspaceCollections();
  }, [
    invalidateWorkspaceCollections,
    renameBranchMutation,
    getWorkspaceRuntimeBlockReason,
    selectedWorkspaceId,
    showToast,
  ]);

  return {
    renameBranch,
    onToggleSidebar: () => setSidebarOpen((value) => !value),
    openRightPanel,
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
