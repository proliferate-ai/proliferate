import { useCallback, useEffect, useRef, useState } from "react";
import { copyText, openExternal } from "@/platform/tauri/shell";
import { useGitHubDesktopAuthAvailability } from "@/hooks/auth/use-github-auth-availability";
import { useGitHubSignIn } from "@/hooks/auth/use-github-sign-in";
import { useToastStore } from "@/stores/toast/toast-store";
import { useWorkspaceMobilityUiStore } from "@/stores/workspaces/workspace-mobility-ui-store";
import { useMobilityPromptState } from "@/hooks/workspaces/mobility/use-mobility-prompt-state";
import { useWorkspaceMobilityCleanupActions } from "@/hooks/workspaces/mobility/use-workspace-mobility-cleanup-actions";
import { useWorkspaceMobilityHandoffActions } from "@/hooks/workspaces/mobility/use-workspace-mobility-handoff-actions";
import { useWorkspaceMobilityState } from "@/hooks/workspaces/mobility/use-workspace-mobility-state";
import { isMobilityPromptPrimaryActionPending } from "@/lib/domain/workspaces/mobility-prompt";
import { buildGitHubOAuthAppSettingsUrl } from "@/lib/integrations/auth/proliferate-auth";
import { elapsedMs, logLatency, startLatencyTimer } from "@/lib/infra/debug-latency";

export function useWorkspaceMobilityFooterFlow() {
  const showToast = useToastStore((state) => state.show);
  const {
    signIn: signInWithGitHub,
    submitting: githubSignInSubmitting,
    signInAvailable: githubSignInAvailable,
    signInUnavailableDescription,
  } = useGitHubSignIn();
  const { data: githubAuthAvailability } = useGitHubDesktopAuthAvailability();
  const mobilityState = useWorkspaceMobilityState();
  const {
    activatePromptRequest,
    clearPrompt,
    clearPromptRequest,
    confirmMove,
    isHandoffPending,
    isSyncingBranch,
    preparePrompt,
    syncBranchForCloudMove,
  } = useWorkspaceMobilityHandoffActions(mobilityState);
  const {
    isRetryingCleanup,
    retryCleanup,
  } = useWorkspaceMobilityCleanupActions(mobilityState);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [hasResolvedPrompt, setHasResolvedPrompt] = useState(false);
  const [isOpeningGitHubAccess, setIsOpeningGitHubAccess] = useState(false);
  const keepPromptOnCloseRef = useRef(false);
  const prepareRequestTokenRef = useRef(0);
  const prompt = useMobilityPromptState(isPreparing, hasResolvedPrompt, popoverOpen);

  const canPrepare = mobilityState.canMoveToCloud || mobilityState.canBringBackLocal;
  const isPending = isHandoffPending || isRetryingCleanup;

  const resetPromptState = useCallback(() => {
    prepareRequestTokenRef.current += 1;
    setIsPreparing(false);
    setHasResolvedPrompt(false);
  }, []);

  const runPromptPreparation = useCallback(async () => {
    const requestToken = prepareRequestTokenRef.current + 1;
    prepareRequestTokenRef.current = requestToken;
    const startedAt = startLatencyTimer();
    logLatency("mobility.footer.prepare.start", {
      requestId: requestToken,
      logicalWorkspaceId: mobilityState.selectedLogicalWorkspaceId,
      selectionLocked: mobilityState.selectionLocked,
      canMoveToCloud: mobilityState.canMoveToCloud,
      canBringBackLocal: mobilityState.canBringBackLocal,
    });
    activatePromptRequest(requestToken);
    clearPrompt();
    setIsPreparing(true);
    setHasResolvedPrompt(false);
    try {
      await preparePrompt(requestToken);
    } catch {
      if (prepareRequestTokenRef.current !== requestToken) {
        return;
      }
      setIsPreparing(false);
      setHasResolvedPrompt(true);
      return;
    }
    const activeRequestId = mobilityState.selectedLogicalWorkspaceId
      ? useWorkspaceMobilityUiStore.getState().activePromptRequestIdByLogicalWorkspaceId[
        mobilityState.selectedLogicalWorkspaceId
      ] ?? null
      : null;
    if (
      prepareRequestTokenRef.current !== requestToken
      || activeRequestId !== requestToken
    ) {
      logLatency("mobility.footer.prepare.stale", {
        requestId: requestToken,
        logicalWorkspaceId: mobilityState.selectedLogicalWorkspaceId,
        activeRequestId,
        elapsedMs: elapsedMs(startedAt),
      });
      return;
    }
    setIsPreparing(false);
    setHasResolvedPrompt(true);
    const confirmSnapshot = mobilityState.selectedLogicalWorkspaceId
      ? useWorkspaceMobilityUiStore.getState().confirmSnapshotByLogicalWorkspaceId[
        mobilityState.selectedLogicalWorkspaceId
      ] ?? null
      : null;
    logLatency("mobility.footer.prepare.complete", {
      requestId: requestToken,
      logicalWorkspaceId: mobilityState.selectedLogicalWorkspaceId,
      hasConfirmSnapshot: Boolean(confirmSnapshot),
      elapsedMs: elapsedMs(startedAt),
    });
  }, [
    activatePromptRequest,
    clearPrompt,
    mobilityState.canBringBackLocal,
    mobilityState.canMoveToCloud,
    mobilityState.selectedLogicalWorkspaceId,
    mobilityState.selectionLocked,
    preparePrompt,
  ]);

  useEffect(() => {
    if (!popoverOpen) {
      return;
    }

    if (mobilityState.selectionLocked || !canPrepare) {
      setIsPreparing(false);
      setHasResolvedPrompt(true);
      return;
    }

    if (isPreparing || hasResolvedPrompt) {
      return;
    }

    void runPromptPreparation();
  }, [
    canPrepare,
    hasResolvedPrompt,
    isPreparing,
    mobilityState.selectionLocked,
    popoverOpen,
    runPromptPreparation,
  ]);

  useEffect(() => {
    if (!mobilityState.selectionLocked || (!popoverOpen && !confirmOpen)) {
      return;
    }

    keepPromptOnCloseRef.current = false;
    setPopoverOpen(false);
    setConfirmOpen(false);
    resetPromptState();
    clearPromptRequest();
    clearPrompt();
  }, [
    clearPrompt,
    clearPromptRequest,
    confirmOpen,
    mobilityState.selectionLocked,
    popoverOpen,
    resetPromptState,
  ]);

  const handleCopy = useCallback(async (value: string | null, label: string) => {
    if (!value) {
      return;
    }
    try {
      await copyText(value);
      showToast(`${label} copied`, "info");
    } catch {
      showToast(`Failed to copy ${label.toLowerCase()}.`);
    }
  }, [showToast]);

  const closePopover = useCallback(() => {
    keepPromptOnCloseRef.current = false;
    setPopoverOpen(false);
    resetPromptState();
    clearPromptRequest();
    clearPrompt();
  }, [
    clearPrompt,
    clearPromptRequest,
    resetPromptState,
  ]);

  const handlePopoverOpenChange = useCallback((open: boolean) => {
    logLatency("mobility.footer.popover", {
      open,
      logicalWorkspaceId: mobilityState.selectedLogicalWorkspaceId,
      selectionLocked: mobilityState.selectionLocked,
      canPrepare,
    });
    setPopoverOpen(open);
    if (!open) {
      resetPromptState();
      clearPromptRequest();
      if (keepPromptOnCloseRef.current) {
        keepPromptOnCloseRef.current = false;
        return;
      }
      clearPrompt();
    }
  }, [
    canPrepare,
    clearPrompt,
    clearPromptRequest,
    mobilityState.selectedLogicalWorkspaceId,
    mobilityState.selectionLocked,
    resetPromptState,
  ]);

  const handlePrimaryAction = useCallback(async () => {
    if (!prompt) {
      return;
    }

    switch (prompt.primaryActionKind) {
      case "confirm_move":
        keepPromptOnCloseRef.current = true;
        setConfirmOpen(true);
        setPopoverOpen(false);
        return;
      case "connect_github":
        if (!githubSignInAvailable) {
          showToast(signInUnavailableDescription);
          return;
        }
        try {
          await signInWithGitHub({ prompt: "select_account" });
          resetPromptState();
          clearPrompt();
          await runPromptPreparation();
        } catch (error) {
          showToast(error instanceof Error ? error.message : "GitHub sign-in failed.");
        }
        return;
      case "manage_github_access":
        setIsOpeningGitHubAccess(true);
        try {
          await openExternal(buildGitHubOAuthAppSettingsUrl(githubAuthAvailability?.clientId));
          showToast("Update GitHub repo access in your browser, then try the move again.", "info");
          closePopover();
        } catch {
          showToast("Couldn't open GitHub access settings.");
        } finally {
          setIsOpeningGitHubAccess(false);
        }
        return;
      case "publish_branch":
      case "push_commits": {
        const didSyncBranch = await syncBranchForCloudMove();
        if (!didSyncBranch) {
          return;
        }
        resetPromptState();
        clearPrompt();
        await runPromptPreparation();
        return;
      }
      case "retry_cleanup":
        await retryCleanup();
        closePopover();
        return;
      case "retry_prepare":
        resetPromptState();
        await runPromptPreparation();
        return;
      default:
        closePopover();
    }
  }, [
    closePopover,
    clearPrompt,
    githubAuthAvailability?.clientId,
    githubSignInAvailable,
    prompt,
    resetPromptState,
    retryCleanup,
    runPromptPreparation,
    showToast,
    signInUnavailableDescription,
    signInWithGitHub,
    syncBranchForCloudMove,
  ]);

  const handleConfirmClose = useCallback(() => {
    setConfirmOpen(false);
    clearPrompt();
  }, [clearPrompt]);

  const handleConfirm = useCallback(async () => {
    setConfirmOpen(false);
    try {
      await confirmMove();
    } catch {
      // Directional handoff hooks already toast failures; this prevents a
      // dropped rejection after the confirmation dialog hands off to overlay.
    }
  }, [confirmMove]);

  return {
    prompt,
    popoverOpen,
    confirmOpen,
    confirmSnapshot: mobilityState.confirmSnapshot,
    isPending,
    isSyncingBranch,
    isPromptActionPending: prompt
      ? isMobilityPromptPrimaryActionPending(prompt, {
        isMobilityPending: isPending,
        isBranchSyncing: isSyncingBranch,
      })
        || (prompt.primaryActionKind === "connect_github" && githubSignInSubmitting)
        || (prompt.primaryActionKind === "manage_github_access" && isOpeningGitHubAccess)
      : false,
    handleCopy,
    handlePopoverOpenChange,
    closePopover,
    handlePrimaryAction,
    handleConfirmClose,
    handleConfirm,
  };
}
