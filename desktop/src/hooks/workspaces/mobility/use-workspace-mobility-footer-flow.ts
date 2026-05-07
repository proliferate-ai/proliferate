import { useCallback, useEffect, useRef, useState } from "react";
import { copyText, openExternal } from "@/platform/tauri/shell";
import { useGitHubDesktopAuthAvailability } from "@/hooks/auth/use-github-auth-availability";
import { useGitHubSignIn } from "@/hooks/auth/use-github-sign-in";
import { useToastStore } from "@/stores/toast/toast-store";
import { useWorkspaceMobilityUiStore } from "@/stores/workspaces/workspace-mobility-ui-store";
import { useMobilityPromptState } from "@/hooks/workspaces/mobility/use-mobility-prompt-state";
import { useWorkspaceMobilityHandoffActions } from "@/hooks/workspaces/mobility/use-workspace-mobility-handoff-actions";
import { useWorkspaceMobilityState } from "@/hooks/workspaces/mobility/use-workspace-mobility-state";
import { isWorkspaceMobilityTransitionPhase } from "@/lib/domain/workspaces/mobility-state-machine";
import { resolveMobilityFooterProgressStatus } from "@/lib/domain/workspaces/mobility-footer-progress";
import type { WorkspaceMobilityDirection } from "@/lib/domain/workspaces/mobility/types";
import { isMobilityPromptPrimaryActionPending } from "@/lib/domain/workspaces/mobility-prompt";
import { buildGitHubOAuthAppSettingsUrl } from "@/lib/integrations/auth/proliferate-auth";
import { elapsedMs, logLatency, startLatencyTimer } from "@/lib/infra/measurement/debug-latency";

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
    isSyncingBranch,
    preparePrompt,
    syncBranchForCloudMove,
  } = useWorkspaceMobilityHandoffActions(mobilityState);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [hasResolvedPrompt, setHasResolvedPrompt] = useState(false);
  const [preparationError, setPreparationError] = useState<string | null>(null);
  const [isOpeningGitHubAccess, setIsOpeningGitHubAccess] = useState(false);
  const [optimisticProgressDirection, setOptimisticProgressDirection] =
    useState<WorkspaceMobilityDirection | null>(null);
  const prepareRequestTokenRef = useRef(0);
  const rawPrompt = useMobilityPromptState(
    isPreparing,
    hasResolvedPrompt,
    popoverOpen && !mobilityState.selectionLocked,
    preparationError,
  );
  const prompt = mobilityState.selectionLocked ? null : rawPrompt;

  const canPrepare = mobilityState.canMoveToCloud || mobilityState.canBringBackLocal;
  const statusIsTransitioning = isWorkspaceMobilityTransitionPhase(mobilityState.status.phase);
  const progressStatus = resolveMobilityFooterProgressStatus({
    canBringBackLocal: mobilityState.canBringBackLocal,
    canMoveToCloud: mobilityState.canMoveToCloud,
    confirmDirection: mobilityState.confirmSnapshot?.direction ?? null,
    optimisticProgressDirection,
    statusDirection: mobilityState.status.direction,
    statusPhase: mobilityState.status.phase,
  });

  const resetPromptState = useCallback(() => {
    prepareRequestTokenRef.current += 1;
    setIsPreparing(false);
    setHasResolvedPrompt(false);
    setPreparationError(null);
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
    setPreparationError(null);
    setIsPreparing(true);
    setHasResolvedPrompt(false);
    try {
      await preparePrompt(requestToken);
    } catch (error) {
      if (prepareRequestTokenRef.current !== requestToken) {
        return;
      }
      setIsPreparing(false);
      setHasResolvedPrompt(true);
      setPreparationError(error instanceof Error ? error.message : "Failed to load workspace mobility details.");
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
    setOptimisticProgressDirection(null);
  }, [mobilityState.selectedLogicalWorkspaceId]);

  useEffect(() => {
    if (
      statusIsTransitioning
      || mobilityState.status.phase === "success"
      || mobilityState.status.phase === "cleanup_failed"
      || mobilityState.status.phase === "failed"
    ) {
      setOptimisticProgressDirection(null);
    }
  }, [
    mobilityState.status.phase,
    statusIsTransitioning,
  ]);

  useEffect(() => {
    if (!popoverOpen) {
      return;
    }

    if (mobilityState.selectionLocked || !canPrepare) {
      setIsPreparing(false);
      setHasResolvedPrompt(true);
      setPreparationError(null);
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
    if (!mobilityState.selectionLocked || !popoverOpen) {
      return;
    }

    setPopoverOpen(false);
    resetPromptState();
    clearPromptRequest();
    clearPrompt();
  }, [
    clearPrompt,
    clearPromptRequest,
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

    if (open && mobilityState.selectionLocked) {
      setPopoverOpen(false);
      return;
    }

    setPopoverOpen(open);
    if (!open) {
      resetPromptState();
      clearPromptRequest();
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
        setOptimisticProgressDirection(mobilityState.confirmSnapshot?.direction ?? mobilityState.status.direction);
        setPopoverOpen(false);
        resetPromptState();
        clearPromptRequest();
        try {
          await confirmMove();
        } catch {
          setOptimisticProgressDirection(null);
          // Directional handoff hooks already toast failures; this prevents a
          // dropped rejection after the card hands off to overlay.
        } finally {
          clearPrompt();
        }
        return;
      case "connect_github":
        if (!githubSignInAvailable) {
          setPreparationError(signInUnavailableDescription);
          setHasResolvedPrompt(true);
          return;
        }
        try {
          await signInWithGitHub({ prompt: "select_account" });
          resetPromptState();
          clearPrompt();
          await runPromptPreparation();
        } catch (error) {
          setPreparationError(error instanceof Error ? error.message : "GitHub sign-in failed.");
          setHasResolvedPrompt(true);
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
    clearPromptRequest,
    confirmMove,
    githubAuthAvailability?.clientId,
    githubSignInAvailable,
    mobilityState.confirmSnapshot?.direction,
    mobilityState.status.direction,
    prompt,
    resetPromptState,
    runPromptPreparation,
    showToast,
    signInUnavailableDescription,
    signInWithGitHub,
    syncBranchForCloudMove,
  ]);

  return {
    prompt,
    progressStatus,
    popoverOpen,
    confirmSnapshot: mobilityState.confirmSnapshot,
    isSyncingBranch,
    isPromptActionPending: prompt
      ? isMobilityPromptPrimaryActionPending(prompt, {
        isBranchSyncing: isSyncingBranch,
      })
        || (prompt.primaryActionKind === "connect_github" && githubSignInSubmitting)
        || (prompt.primaryActionKind === "manage_github_access" && isOpeningGitHubAccess)
      : false,
    handleCopy,
    handlePopoverOpenChange,
    closePopover,
    handlePrimaryAction,
  };
}
