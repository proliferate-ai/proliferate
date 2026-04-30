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
import type { RightPanelTool } from "@/lib/domain/workspaces/right-panel";
import type {
  MainScreenDataState,
  MainScreenLayoutState,
} from "./use-main-screen-state";

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
  const { getWorkspaceRuntimeBlockReason } = useWorkspaceRuntimeBlock();
  const showToast = useToastStore((state) => state.show);
  const {
    rightPanelOpen,
    rightPanelState,
    setRightPanelState,
    setSidebarOpen,
    setRightPanelOpen,
    setTerminalActivationRequestToken,
    setCommitOpen,
    setFilePaletteOpen,
    setPushOpen,
    setPrOpen,
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

  const openPrInBrowser = useCallback(() => {
    if (existingPr?.url) {
      void openExternal(existingPr.url);
    }
  }, [existingPr]);

  const handleCommitOpen = useCallback(() => {
    openRightPanelTool("git");
    setCommitOpen(true);
  }, [openRightPanelTool, setCommitOpen]);

  const handlePushOpen = useCallback(() => {
    openRightPanelTool("git");
    setPushOpen(true);
  }, [openRightPanelTool, setPushOpen]);

  const handlePrOpen = useCallback(() => {
    openRightPanelTool("git");
    setPrOpen(true);
  }, [openRightPanelTool, setPrOpen]);

  const handleFilePaletteOpen = useCallback(() => {
    setFilePaletteOpen(true);
  }, [setFilePaletteOpen]);

  const handleViewPr = useCallback(() => {
    openRightPanelTool("git");
    openPrInBrowser();
  }, [openPrInBrowser, openRightPanelTool]);

  const openPrDialog = useCallback(() => {
    setPrOpen(true);
  }, [setPrOpen]);

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
    handleCommitOpen,
    handlePushOpen,
    handlePrOpen,
    handleFilePaletteOpen,
    handleViewPr,
    openPrDialog,
    onCommitClose: () => setCommitOpen(false),
    onFilePaletteClose: () => setFilePaletteOpen(false),
    onPushClose: () => setPushOpen(false),
    onPrClose: () => setPrOpen(false),
  };
}
