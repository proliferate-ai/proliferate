import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTauriShellActions } from "@/hooks/access/tauri/use-shell-actions";
import { useGitHubDesktopAuthAvailability } from "@/hooks/access/cloud/auth/use-github-auth-availability";
import { useGitHubSignIn } from "@/hooks/auth/workflows/use-github-sign-in";
import { useComputeTargetOptions } from "@/hooks/compute/derived/use-compute-target-options";
import { useMobilityFooterContext } from "@/hooks/workspaces/derived/mobility/use-mobility-footer-context";
import { useToastStore } from "@/stores/toast/toast-store";
import { useWorkspaceMobilityGitPrepWorkflow } from "@/hooks/workspaces/workflows/mobility/use-workspace-mobility-git-prep-workflow";
import { useWorkspaceMobilityState } from "@/hooks/workspaces/derived/mobility/use-workspace-mobility-state";
import { isWorkspaceMobilityTransitionPhase } from "@/lib/domain/workspaces/mobility/mobility-state-machine";
import { resolveMobilityFooterProgressStatus } from "@/lib/domain/workspaces/mobility/mobility-footer-progress";
import type { WorkspaceMobilityDirection } from "@/lib/domain/workspaces/mobility/types";
import { isMobilityFooterPromptActionPending } from "@/lib/domain/workspaces/mobility/mobility-footer-flow";
import {
  buildWorkspaceMobilityDestinationOptions,
  type WorkspaceMobilityDestinationId,
  type WorkspaceMobilityDestinationOption,
} from "@/lib/domain/workspaces/mobility/mobility-destinations";
import { buildGitHubOAuthAppSettingsUrl } from "@/lib/integrations/auth/proliferate-auth";
import { logLatency } from "@/lib/infra/measurement/debug-latency";
import { useWorkspaceMobilityFooterGitPanelAction } from "@/hooks/workspaces/ui/mobility/use-workspace-mobility-footer-git-panel-action";
import { useWorkspaceMobilityFooterPromptPreparation } from "@/hooks/workspaces/ui/mobility/use-workspace-mobility-footer-prompt-preparation";

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
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [gitPrepDialogOpen, setGitPrepDialogOpen] = useState(false);
  const [selectedDestinationId, setSelectedDestinationId] =
    useState<WorkspaceMobilityDestinationId | null>(null);
  const [isOpeningGitHubAccess, setIsOpeningGitHubAccess] = useState(false);
  const [optimisticProgressDirection, setOptimisticProgressDirection] =
    useState<WorkspaceMobilityDirection | null>(null);
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
  const {
    prompt,
    isPreparing,
    hasResolvedPrompt,
    isSyncingBranch,
    resetPromptState,
    setPreparationFailure,
    resolvePromptWithoutPreparation,
    runPromptPreparation,
    rerunPreparationAndAutoMove,
    clearPrompt,
    clearPromptRequest,
    syncBranchForSelectedMove,
  } = useWorkspaceMobilityFooterPromptPreparation({
    mobilityState,
    popoverOpen,
    selectedDestinationId,
    setPopoverOpen,
    setSelectedDestinationId,
    setOptimisticProgressDirection,
  });
  const openGitPanel = useWorkspaceMobilityFooterGitPanelAction(mobilityState);

  const isPromptActionPending = isMobilityFooterPromptActionPending(prompt, {
    isBranchSyncing: isSyncingBranch,
    isGitHubSignInSubmitting: githubSignInSubmitting,
    isOpeningGitHubAccess,
  });

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
      resolvePromptWithoutPreparation();
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
    resolvePromptWithoutPreparation,
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
          setPreparationFailure(signInUnavailableDescription);
          return;
        }
        try {
          await signInWithGitHub({ prompt: "select_account" });
          resetPromptState();
          clearPrompt();
          await runPromptPreparation();
        } catch (error) {
          setPreparationFailure(error instanceof Error ? error.message : "GitHub sign-in failed.");
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
    githubAuthAvailability?.clientId,
    githubSignInAvailable,
    openExternal,
    prompt,
    resetPromptState,
    runPromptPreparation,
    setPreparationFailure,
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
