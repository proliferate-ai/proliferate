import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTauriShellActions } from "@/hooks/access/tauri/use-shell-actions";
import { useGitHubDesktopAuthAvailability } from "@/hooks/access/cloud/auth/use-github-auth-availability";
import { useGitHubSignIn } from "@/hooks/auth/workflows/use-github-sign-in";
import { useComputeTargetOptions } from "@/hooks/compute/derived/use-compute-target-options";
import { useMobilityFooterContext } from "@/hooks/workspaces/derived/mobility/use-mobility-footer-context";
import { useToastStore } from "@/stores/toast/toast-store";
import { useWorkspaceMobilityUiStore } from "@/stores/workspaces/workspace-mobility-ui-store";
import { useMobilityPromptState } from "@/hooks/workspaces/derived/mobility/use-mobility-prompt-state";
import { useWorkspaceMobilityHandoffActions } from "@/hooks/workspaces/workflows/mobility/use-workspace-mobility-handoff-actions";
import { useWorkspaceMobilityGitPrepWorkflow } from "@/hooks/workspaces/workflows/mobility/use-workspace-mobility-git-prep-workflow";
import { useWorkspaceMobilityState } from "@/hooks/workspaces/derived/mobility/use-workspace-mobility-state";
import { isWorkspaceMobilityTransitionPhase } from "@/lib/domain/workspaces/mobility/mobility-state-machine";
import { resolveMobilityFooterProgressStatus } from "@/lib/domain/workspaces/mobility/mobility-footer-progress";
import type {
  WorkspaceMobilityConfirmSnapshot,
  WorkspaceMobilityDirection,
} from "@/lib/domain/workspaces/mobility/types";
import { isMobilityPromptPrimaryActionPending } from "@/lib/domain/workspaces/mobility/mobility-prompt";
import {
  buildWorkspaceMobilityDestinationOptions,
  type WorkspaceMobilityDestinationId,
  type WorkspaceMobilityDestinationOption,
} from "@/lib/domain/workspaces/mobility/mobility-destinations";
import { buildGitHubOAuthAppSettingsUrl } from "@/lib/integrations/auth/proliferate-auth";
import { elapsedMs, logLatency, startLatencyTimer } from "@/lib/infra/measurement/debug-latency";
import { rightPanelToolHeaderKey } from "@/lib/domain/workspaces/shell/right-panel-model";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import { useGitPanelUiStore } from "@/stores/editor/git-panel-ui-store";

function snapshotReadyToMove(snapshot: WorkspaceMobilityConfirmSnapshot | null): snapshot is WorkspaceMobilityConfirmSnapshot {
  return Boolean(
    snapshot
    && snapshot.sourcePreflight.canMove
    && snapshot.cloudPreflight.canStart
    && (snapshot.sourcePreflight.blockers?.length ?? 0) === 0
    && (snapshot.cloudPreflight.blockers?.length ?? 0) === 0,
  );
}

export function useWorkspaceMobilityFooterFlow() {
  const { openExternal } = useTauriShellActions();
  const footerContext = useMobilityFooterContext();
  const showToast = useToastStore((state) => state.show);
  const {
    signIn: signInWithGitHub,
    submitting: githubSignInSubmitting,
    signInAvailable: githubSignInAvailable,
    signInUnavailableDescription,
  } = useGitHubSignIn();
  const { data: githubAuthAvailability } = useGitHubDesktopAuthAvailability();
  const mobilityState = useWorkspaceMobilityState();
  const computeTargets = useComputeTargetOptions({
    enabled: Boolean(footerContext),
  });
  const {
    activatePromptRequest,
    clearPrompt,
    clearPromptRequest,
    confirmMove,
    isSyncingBranch,
    preparePrompt,
    syncBranchForSelectedMove,
  } = useWorkspaceMobilityHandoffActions(mobilityState);
  const setRightPanelMaterializedForWorkspace = useWorkspaceUiStore(
    (state) => state.setRightPanelMaterializedForWorkspace,
  );
  const setRightPanelOpenForWorkspace = useWorkspaceUiStore(
    (state) => state.setRightPanelOpenForWorkspace,
  );
  const requestGitPanelMode = useGitPanelUiStore((state) => state.requestModeForWorkspace);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [gitPrepDialogOpen, setGitPrepDialogOpen] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [hasResolvedPrompt, setHasResolvedPrompt] = useState(false);
  const [preparationError, setPreparationError] = useState<string | null>(null);
  const [selectedDestinationId, setSelectedDestinationId] =
    useState<WorkspaceMobilityDestinationId | null>(null);
  const [isOpeningGitHubAccess, setIsOpeningGitHubAccess] = useState(false);
  const [optimisticProgressDirection, setOptimisticProgressDirection] =
    useState<WorkspaceMobilityDirection | null>(null);
  const prepareRequestTokenRef = useRef(0);
  const preservePromptOnPopoverCloseRef = useRef(false);
  const destinationOptions = useMemo(() => (
    footerContext
      ? buildWorkspaceMobilityDestinationOptions({
        locationKind: footerContext.locationKind,
        sshTargets: computeTargets.sshTargetOptions,
      })
      : []
  ), [
    computeTargets.sshTargetOptions,
    footerContext,
  ]);
  const selectedDestination = useMemo(() => (
    destinationOptions.find((option) => option.id === selectedDestinationId) ?? null
  ), [
    destinationOptions,
    selectedDestinationId,
  ]);
  const rawPrompt = useMobilityPromptState(
    isPreparing,
    hasResolvedPrompt,
    popoverOpen && selectedDestination !== null && !mobilityState.selectionLocked,
    preparationError,
  );
  const prompt = mobilityState.selectionLocked ? null : rawPrompt;
  const gitPrepWorkflow = useWorkspaceMobilityGitPrepWorkflow({
    workspaceId: mobilityState.confirmSnapshot?.sourceWorkspaceId ?? null,
    direction: mobilityState.confirmSnapshot?.direction ?? null,
    enabled: gitPrepDialogOpen && Boolean(mobilityState.confirmSnapshot?.sourceWorkspaceId),
  });

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

  const readFreshConfirmSnapshot = useCallback(() => {
    const logicalWorkspaceId = mobilityState.selectedLogicalWorkspaceId;
    if (!logicalWorkspaceId) {
      return null;
    }
    return useWorkspaceMobilityUiStore.getState().confirmSnapshotByLogicalWorkspaceId[
      logicalWorkspaceId
    ] ?? null;
  }, [mobilityState.selectedLogicalWorkspaceId]);

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

  const rerunPreparationAndAutoMove = useCallback(async () => {
    const requestToken = prepareRequestTokenRef.current + 1;
    prepareRequestTokenRef.current = requestToken;
    activatePromptRequest(requestToken);
    clearPrompt();
    setPreparationError(null);
    setIsPreparing(true);
    setHasResolvedPrompt(false);
    try {
      await preparePrompt(requestToken);
    } catch (error) {
      if (prepareRequestTokenRef.current === requestToken) {
        setPreparationError(error instanceof Error ? error.message : "Failed to load workspace mobility details.");
        setHasResolvedPrompt(true);
        setIsPreparing(false);
      }
      return false;
    }

    if (prepareRequestTokenRef.current !== requestToken) {
      return false;
    }

    setIsPreparing(false);
    setHasResolvedPrompt(true);
    const freshSnapshot = readFreshConfirmSnapshot();
    if (!snapshotReadyToMove(freshSnapshot)) {
      setPopoverOpen(true);
      return false;
    }

    setOptimisticProgressDirection(freshSnapshot.direction);
    setPopoverOpen(false);
    setSelectedDestinationId(null);
    clearPromptRequest();
    try {
      await confirmMove(freshSnapshot);
      return true;
    } catch {
      setOptimisticProgressDirection(null);
      return false;
    } finally {
      clearPrompt();
    }
  }, [
    activatePromptRequest,
    clearPrompt,
    clearPromptRequest,
    confirmMove,
    preparePrompt,
    readFreshConfirmSnapshot,
  ]);

  const isPromptActionPending = prompt
    ? isMobilityPromptPrimaryActionPending(prompt, {
      isBranchSyncing: isSyncingBranch,
    })
      || (prompt.primaryActionKind === "connect_github" && githubSignInSubmitting)
      || (prompt.primaryActionKind === "manage_github_access" && isOpeningGitHubAccess)
    : false;

  useEffect(() => {
    resetPromptState();
    setSelectedDestinationId(null);
    setGitPrepDialogOpen(false);
    setOptimisticProgressDirection(null);
  }, [mobilityState.selectedLogicalWorkspaceId, resetPromptState]);

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
    if (!popoverOpen || !selectedDestination) {
      return;
    }

    if (mobilityState.selectionLocked || !selectedDestination.direction || !canPrepare) {
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
    selectedDestination,
  ]);

  useEffect(() => {
    if (!mobilityState.selectionLocked || !popoverOpen) {
      return;
    }

    setPopoverOpen(false);
    setGitPrepDialogOpen(false);
    resetPromptState();
    setSelectedDestinationId(null);
    clearPromptRequest();
    clearPrompt();
  }, [
    clearPrompt,
    clearPromptRequest,
    mobilityState.selectionLocked,
    popoverOpen,
    resetPromptState,
  ]);

  const closePopover = useCallback(() => {
    preservePromptOnPopoverCloseRef.current = false;
    setPopoverOpen(false);
    setGitPrepDialogOpen(false);
    gitPrepWorkflow.resetDraft();
    resetPromptState();
    setSelectedDestinationId(null);
    clearPromptRequest();
    clearPrompt();
  }, [
    clearPrompt,
    clearPromptRequest,
    gitPrepWorkflow,
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
    if (!open && isPromptActionPending) {
      setPopoverOpen(true);
      return;
    }

    setPopoverOpen(open);
    if (!open) {
      if (preservePromptOnPopoverCloseRef.current) {
        preservePromptOnPopoverCloseRef.current = false;
        return;
      }
      resetPromptState();
      setSelectedDestinationId(null);
      setGitPrepDialogOpen(false);
      clearPromptRequest();
      clearPrompt();
    }
  }, [
    canPrepare,
    clearPrompt,
    clearPromptRequest,
    isPromptActionPending,
    mobilityState.selectedLogicalWorkspaceId,
    mobilityState.selectionLocked,
    resetPromptState,
  ]);

  const handleDestinationSelect = useCallback((destination: WorkspaceMobilityDestinationOption) => {
    if (destination.disabledReason) {
      return;
    }
    resetPromptState();
    clearPromptRequest();
    clearPrompt();
    setSelectedDestinationId(destination.id);
  }, [
    clearPrompt,
    clearPromptRequest,
    resetPromptState,
  ]);

  const handleDestinationBack = useCallback(() => {
    if (isPromptActionPending) {
      return;
    }
    resetPromptState();
    clearPromptRequest();
    clearPrompt();
    setSelectedDestinationId(null);
  }, [
    clearPrompt,
    clearPromptRequest,
    isPromptActionPending,
    resetPromptState,
  ]);

  const openGitPanel = useCallback(() => {
    const sourceWorkspaceId = mobilityState.confirmSnapshot?.sourceWorkspaceId
      ?? mobilityState.resolvedWorkspaceId;
    const workspaceUiKey = mobilityState.selectedLogicalWorkspaceId
      ?? sourceWorkspaceId;
    if (!sourceWorkspaceId || !workspaceUiKey) {
      return;
    }
    const gitEntryKey = rightPanelToolHeaderKey("git");
    setRightPanelMaterializedForWorkspace(sourceWorkspaceId, (previous) => ({
      ...previous,
      activeEntryKey: gitEntryKey,
      headerOrder: previous.headerOrder.includes(gitEntryKey)
        ? previous.headerOrder
        : [...previous.headerOrder, gitEntryKey],
    }));
    setRightPanelOpenForWorkspace(workspaceUiKey, true);
    requestGitPanelMode(sourceWorkspaceId, "unstaged");
  }, [
    mobilityState.confirmSnapshot?.sourceWorkspaceId,
    mobilityState.resolvedWorkspaceId,
    mobilityState.selectedLogicalWorkspaceId,
    requestGitPanelMode,
    setRightPanelMaterializedForWorkspace,
    setRightPanelOpenForWorkspace,
  ]);

  const handleOpenGitPanelFromPrep = useCallback(() => {
    preservePromptOnPopoverCloseRef.current = false;
    setGitPrepDialogOpen(false);
    setPopoverOpen(false);
    gitPrepWorkflow.resetDraft();
    resetPromptState();
    setSelectedDestinationId(null);
    clearPromptRequest();
    clearPrompt();
    openGitPanel();
  }, [
    clearPrompt,
    clearPromptRequest,
    gitPrepWorkflow,
    openGitPanel,
    resetPromptState,
  ]);

  const handleSubmitGitPrep = useCallback(async () => {
    const didPrepBranch = await gitPrepWorkflow.submit();
    if (!didPrepBranch) {
      return;
    }
    preservePromptOnPopoverCloseRef.current = false;
    setGitPrepDialogOpen(false);
    await rerunPreparationAndAutoMove();
  }, [
    gitPrepWorkflow,
    rerunPreparationAndAutoMove,
  ]);

  const handlePrimaryAction = useCallback(async () => {
    if (!prompt) {
      return;
    }

    switch (prompt.primaryActionKind) {
      case "confirm_move":
        await rerunPreparationAndAutoMove();
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
        const didSyncBranch = await syncBranchForSelectedMove();
        if (!didSyncBranch) {
          return;
        }
        await rerunPreparationAndAutoMove();
        return;
      }
      case "prepare_branch":
        preservePromptOnPopoverCloseRef.current = true;
        setGitPrepDialogOpen(true);
        setPopoverOpen(false);
        return;
      case "open_git_tools":
        closePopover();
        openGitPanel();
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
    syncBranchForSelectedMove,
    openGitPanel,
    rerunPreparationAndAutoMove,
  ]);

  return {
    prompt,
    failureStatus: mobilityState.status.isFailure
      ? {
        title: mobilityState.status.title ?? "Move did not finish",
        description: mobilityState.status.description ?? "The workspace stayed where it was.",
      }
      : null,
    destinationOptions,
    selectedDestinationId,
    progressStatus,
    popoverOpen,
    confirmSnapshot: mobilityState.confirmSnapshot,
    gitPrepDialogOpen,
    gitPrepWorkflow,
    isSyncingBranch,
    isPromptActionPending,
    handlePopoverOpenChange,
    closePopover,
    handleDestinationSelect,
    handleDestinationBack,
    handlePrimaryAction,
    handleOpenGitPanelFromPrep,
    handleSubmitGitPrep,
  };
}
