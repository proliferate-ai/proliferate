import { useMemo } from "react";
import {
  presentComposerBlockedState,
  resolveComposerBlockedState,
  type ComposerBlockedPresentation,
} from "#product/lib/domain/chat/composer/composer-blocked-state";
import { buildCloudWorkspaceCompactStatusView } from "#product/lib/domain/workspaces/cloud/cloud-workspace-status-presentation";
import { useWorkspaceStatusPanelState } from "#product/hooks/workspaces/derived/use-workspace-status-panel-state";
import { useSelectedCloudRuntimeState } from "#product/hooks/workspaces/facade/use-selected-cloud-runtime-state";
import { useWorktreeMissingActions } from "#product/hooks/workspaces/workflows/use-worktree-missing-actions";
import { usePendingWorkspaceEntryActions } from "#product/hooks/workspaces/workflows/use-pending-workspace-entry-actions";
import { useCloudWorkspaceStatusScreenActions } from "#product/hooks/cloud/workflows/use-cloud-workspace-status-screen-actions";

/**
 * Composer takeover: gathers the same data sources that used to drive the
 * attached workspace-status / cloud-runtime panels and maps them onto a
 * single blocked-status presentation (or null when chat is unblocked). The
 * precedence and per-kind mapping live in the pure
 * `composer-blocked-state.ts` module; this hook only wires React state and
 * live action callbacks into that mapping.
 */
export function useComposerBlockedState(options?: {
  /** Cowork threads suppress the takeover the same way they used to
   * suppress the ambient workspace-status panel (see `showWorkspaceStatusPanels`
   * on ChatView). */
  suppress?: boolean;
}): ComposerBlockedPresentation | null {
  const suppress = options?.suppress ?? false;
  const panelState = useWorkspaceStatusPanelState();
  const worktreeMissingActions = useWorktreeMissingActions({
    workspaceId: panelState?.kind === "directory-missing" ? panelState.workspaceId : "",
  });
  const pendingEntryActions = usePendingWorkspaceEntryActions();
  const cloudStatusActions = useCloudWorkspaceStatusScreenActions({
    workspaceId: panelState?.kind === "cloud-status" ? panelState.workspaceId : "",
    mode: panelState?.kind === "cloud-status" ? panelState.model.mode : "pending",
  });
  const selectedCloudRuntime = useSelectedCloudRuntimeState();

  return useMemo(() => {
    if (suppress) {
      return null;
    }

    const directoryMissing = panelState?.kind === "directory-missing"
      ? {
        workspaceKind: panelState.workspaceKind,
        restoreEligible: panelState.restoreEligible,
        restoreError: worktreeMissingActions.restoreError,
        checkAgain: {
          onSelect: () => {
            void worktreeMissingActions.checkAgain();
          },
          loading: worktreeMissingActions.isCheckingAgain,
          disabled: worktreeMissingActions.isCheckingAgain || worktreeMissingActions.isRestoring,
        },
        restore: {
          onSelect: () => {
            void worktreeMissingActions.restoreWorktree();
          },
          loading: worktreeMissingActions.isRestoring,
          disabled: worktreeMissingActions.isRestoring || worktreeMissingActions.isCheckingAgain,
        },
      }
      : null;

    const provisioning = panelState?.kind === "pending"
      ? {
        isFailed: panelState.isFailed,
        message: panelState.subtitle,
        back: {
          onSelect: () => {
            void pendingEntryActions.handleBack(panelState.entry);
          },
          loading: false,
          disabled: false,
        },
        retry: {
          onSelect: () => {
            void pendingEntryActions.handleRetry(panelState.entry);
          },
          loading: false,
          disabled: false,
        },
      }
      : null;

    const cloudStatus = panelState?.kind === "cloud-status"
      ? {
        mode: panelState.model.mode,
        message: panelState.model.description,
        primaryActionLabel:
          buildCloudWorkspaceCompactStatusView(panelState.model).primaryAction?.label ?? null,
        primaryAction: cloudStatusActions.handlePrimaryAction
          ? {
            onSelect: cloudStatusActions.handlePrimaryAction,
            loading: cloudStatusActions.isPrimaryActionPending,
            disabled: cloudStatusActions.isPrimaryActionPending,
          }
          : null,
      }
      : null;

    const runtimeState = selectedCloudRuntime.state;
    const cloudRuntime =
      runtimeState && runtimeState.phase !== "ready" && runtimeState.title && runtimeState.subtitle
        ? {
          phase: runtimeState.phase,
          message: runtimeState.actionBlockReason ?? runtimeState.subtitle,
          retry: runtimeState.showRetry && selectedCloudRuntime.retry
            ? { onSelect: selectedCloudRuntime.retry, loading: false, disabled: false }
            : null,
          claim: runtimeState.showClaim && selectedCloudRuntime.claim
            ? {
              onSelect: selectedCloudRuntime.claim,
              loading: selectedCloudRuntime.claimPending,
              disabled: selectedCloudRuntime.claimPending,
            }
            : null,
        }
        : null;

    const state = resolveComposerBlockedState({
      directoryMissing,
      provisioning,
      cloudStatus,
      cloudRuntime,
    });

    return state ? presentComposerBlockedState(state) : null;
  }, [
    suppress,
    panelState,
    worktreeMissingActions,
    pendingEntryActions,
    cloudStatusActions,
    selectedCloudRuntime,
  ]);
}
