import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatedSwapText } from "@/components/ui/AnimatedSwapText";
import { useToastStore } from "@/stores/toast/toast-store";
import { useWorkspaceMobilityUiStore } from "@/stores/workspaces/workspace-mobility-ui-store";
import { useWorkspaceMobility } from "@/hooks/workspaces/use-workspace-mobility";
import { useMobilityFooterContext } from "@/hooks/workspaces/mobility/use-mobility-footer-context";
import { useMobilityPromptState } from "@/hooks/workspaces/mobility/use-mobility-prompt-state";
import { isMobilityPromptPrimaryActionPending } from "@/lib/domain/workspaces/mobility-prompt";
import { elapsedMs, logLatency, startLatencyTimer } from "@/lib/infra/debug-latency";
import { PopoverButton } from "@/components/ui/PopoverButton";
import {
  ChevronDown,
  CloudIcon,
  Copy,
  Folder,
  FolderOpen,
  GitBranch,
} from "@/components/ui/icons";
import { ComposerControlButton } from "./ComposerControlButton";
import { WorkspaceMobilityLocationPopover } from "./WorkspaceMobilityLocationPopover";
import { WorkspaceMobilityConfirmDialog } from "./WorkspaceMobilityConfirmDialog";

function FooterPathLabel({ value }: { value: string }) {
  return (
    <span title={value} className="[direction:ltr] [unicode-bidi:plaintext]">
      {value}
    </span>
  );
}

function locationIcon(kind: "local_workspace" | "local_worktree" | "cloud_workspace") {
  switch (kind) {
    case "cloud_workspace":
      return <CloudIcon className="size-3.5" />;
    case "local_worktree":
      return <FolderOpen className="size-3.5" />;
    case "local_workspace":
    default:
      return <Folder className="size-3.5" />;
  }
}

export function WorkspaceMobilityFooterRow() {
  const showToast = useToastStore((state) => state.show);
  const footerContext = useMobilityFooterContext();
  const mobility = useWorkspaceMobility();
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [hasResolvedPrompt, setHasResolvedPrompt] = useState(false);
  const keepPromptOnCloseRef = useRef(false);
  const prepareRequestTokenRef = useRef(0);
  const prompt = useMobilityPromptState(isPreparing, hasResolvedPrompt, popoverOpen);

  const canPrepare = mobility.canMoveToCloud || mobility.canBringBackLocal;

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
      logicalWorkspaceId: mobility.selectedLogicalWorkspaceId,
      selectionLocked: mobility.selectionLocked,
      canMoveToCloud: mobility.canMoveToCloud,
      canBringBackLocal: mobility.canBringBackLocal,
    });
    mobility.activatePromptRequest(requestToken);
    mobility.clearPrompt();
    setIsPreparing(true);
    setHasResolvedPrompt(false);
    try {
      await mobility.preparePrompt(requestToken);
    } catch {
      if (prepareRequestTokenRef.current !== requestToken) {
        return;
      }
      setIsPreparing(false);
      setHasResolvedPrompt(true);
      return;
    }
    const activeRequestId = mobility.selectedLogicalWorkspaceId
      ? useWorkspaceMobilityUiStore.getState().activePromptRequestIdByLogicalWorkspaceId[
        mobility.selectedLogicalWorkspaceId
      ] ?? null
      : null;
    if (
      prepareRequestTokenRef.current !== requestToken
      || activeRequestId !== requestToken
    ) {
      logLatency("mobility.footer.prepare.stale", {
        requestId: requestToken,
        logicalWorkspaceId: mobility.selectedLogicalWorkspaceId,
        activeRequestId,
        elapsedMs: elapsedMs(startedAt),
      });
      return;
    }
    setIsPreparing(false);
    setHasResolvedPrompt(true);
    const confirmSnapshot = mobility.selectedLogicalWorkspaceId
      ? useWorkspaceMobilityUiStore.getState().confirmSnapshotByLogicalWorkspaceId[
        mobility.selectedLogicalWorkspaceId
      ] ?? null
      : null;
    logLatency("mobility.footer.prepare.complete", {
      requestId: requestToken,
      logicalWorkspaceId: mobility.selectedLogicalWorkspaceId,
      hasConfirmSnapshot: Boolean(confirmSnapshot),
      elapsedMs: elapsedMs(startedAt),
    });
  }, [mobility]);

  useEffect(() => {
    if (!popoverOpen) {
      return;
    }

    if (mobility.selectionLocked || !canPrepare) {
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
    mobility.confirmSnapshot,
    mobility.selectionLocked,
    popoverOpen,
    hasResolvedPrompt,
    isPreparing,
    runPromptPreparation,
  ]);

  const handleCopy = useCallback(async (value: string | null, label: string) => {
    if (!value) {
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      showToast(`${label} copied`, "info");
    } catch {
      showToast(`Failed to copy ${label.toLowerCase()}.`);
    }
    }, [showToast]);

  const closePopover = useCallback(() => {
    keepPromptOnCloseRef.current = false;
    setPopoverOpen(false);
    resetPromptState();
    mobility.clearPromptRequest();
    mobility.clearPrompt();
  }, [mobility, resetPromptState]);

  const handlePopoverOpenChange = useCallback((open: boolean) => {
    logLatency("mobility.footer.popover", {
      open,
      logicalWorkspaceId: mobility.selectedLogicalWorkspaceId,
      selectionLocked: mobility.selectionLocked,
      canPrepare,
    });
    setPopoverOpen(open);
    if (!open) {
      resetPromptState();
      mobility.clearPromptRequest();
      if (keepPromptOnCloseRef.current) {
        keepPromptOnCloseRef.current = false;
        return;
      }
      mobility.clearPrompt();
    }
  }, [canPrepare, mobility, resetPromptState]);

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
      case "publish_branch":
      case "push_commits": {
        const didSyncBranch = await mobility.syncBranchForCloudMove();
        if (!didSyncBranch) {
          return;
        }
        resetPromptState();
        mobility.clearPrompt();
        await runPromptPreparation();
        return;
      }
      case "retry_cleanup":
        await mobility.retryCleanup();
        closePopover();
        return;
      case "retry_prepare":
        resetPromptState();
        await runPromptPreparation();
        return;
      default:
        closePopover();
    }
  }, [closePopover, mobility, prompt, resetPromptState, runPromptPreparation]);

  const handleConfirmClose = useCallback(() => {
    setConfirmOpen(false);
    mobility.clearPrompt();
  }, [mobility]);

  const handleConfirm = useCallback(async () => {
    setConfirmOpen(false);
    await mobility.confirmMove();
  }, [mobility]);

  if (!footerContext) {
    return null;
  }

  const locationTrigger = prompt ? (
    <PopoverButton
      externalOpen={popoverOpen}
      onOpenChange={handlePopoverOpenChange}
      trigger={(
        <ComposerControlButton
          icon={locationIcon(footerContext.locationKind)}
          label={<AnimatedSwapText value={footerContext.locationLabel} />}
          trailing={<ChevronDown className="size-3.5 text-muted-foreground/70" />}
          active={popoverOpen || footerContext.isActive}
          disabled={!footerContext.isInteractive}
          data-telemetry-mask
        />
      )}
      align="start"
      side="top"
      offset={8}
      className="w-auto border-0 bg-transparent p-0 shadow-none"
    >
      {(close) => (
        <WorkspaceMobilityLocationPopover
          prompt={prompt}
          isActionPending={isMobilityPromptPrimaryActionPending(prompt, {
            isMobilityPending: mobility.isPending,
            isBranchSyncing: mobility.isSyncingBranch,
          })}
          onClose={() => {
            close();
            closePopover();
          }}
          onPrimaryAction={handlePrimaryAction}
        />
      )}
    </PopoverButton>
  ) : null;

  return (
    <>
      <div className="rounded-[var(--radius-composer)]  px-2 pt-2 ">
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
          {locationTrigger}

          {footerContext.pathLabel && (
            <ComposerControlButton
              icon={<Folder className="size-3.5" />}
              label={<FooterPathLabel value={footerContext.pathLabel} />}
              labelClassName="[direction:rtl]"
              trailing={<Copy className="size-3 text-muted-foreground/70" />}
              onClick={() => {
                void handleCopy(footerContext.pathValue, "Path");
              }}
              title={footerContext.pathValue ?? undefined}
              data-telemetry-mask
            />
          )}

          {footerContext.branchLabel && (
            <ComposerControlButton
              icon={<GitBranch className="size-3.5" />}
              label={footerContext.branchLabel}
              trailing={<Copy className="size-3 text-muted-foreground/70" />}
              onClick={() => {
                void handleCopy(footerContext.branchValue, "Branch");
              }}
              title={footerContext.branchValue ?? undefined}
              data-telemetry-mask
            />
          )}
        </div>
      </div>

      <WorkspaceMobilityConfirmDialog
        snapshot={mobility.confirmSnapshot}
        open={confirmOpen && mobility.confirmSnapshot !== null}
        isPending={mobility.isPending}
        onClose={handleConfirmClose}
        onConfirm={handleConfirm}
      />
    </>
  );
}
