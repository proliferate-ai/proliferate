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
import type { RightPanelMode } from "@/components/workspace/shell/right-panel/RightPanel";
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
    setRightPanelMode,
    setSidebarOpen,
    setRightPanelOpen,
    setTerminalCollapsed,
    setTerminalFocusRequestToken,
    setCommitOpen,
    setFilePaletteOpen,
    setPushOpen,
    setPrOpen,
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

  const openPrInBrowser = useCallback(() => {
    if (existingPr?.url) {
      void openExternal(existingPr.url);
    }
  }, [existingPr]);

  const handleCommitOpen = useCallback(() => {
    openRightPanelMode("changes");
    setCommitOpen(true);
  }, [openRightPanelMode, setCommitOpen]);

  const handlePushOpen = useCallback(() => {
    openRightPanelMode("changes");
    setPushOpen(true);
  }, [openRightPanelMode, setPushOpen]);

  const handlePrOpen = useCallback(() => {
    openRightPanelMode("changes");
    setPrOpen(true);
  }, [openRightPanelMode, setPrOpen]);

  const handleFilePaletteOpen = useCallback(() => {
    setFilePaletteOpen(true);
  }, [setFilePaletteOpen]);

  const handleViewPr = useCallback(() => {
    openRightPanelMode("changes");
    openPrInBrowser();
  }, [openPrInBrowser, openRightPanelMode]);

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
    onSetRightPanelMode: setRightPanelMode,
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
