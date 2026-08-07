import type { Workspace } from "@anyharness/sdk";
import type { CloudWorkspaceStatusScreenMode } from "#product/lib/domain/workspaces/cloud/cloud-workspace-status-presentation";
import type { SelectedCloudRuntimePhase } from "#product/lib/domain/workspaces/cloud/cloud-runtime-state";
import { missingCheckoutComposerMessage } from "#product/copy/workspaces/workspace-availability-copy";

/**
 * Composer takeover (Blocked Status design): when a persistent condition
 * blocks chat, the composer's own textarea area becomes a one-line status
 * with recovery actions instead of an attached tray/panel. This module is
 * the pure state → presentation mapping — no React, no stores — so the
 * precedence between blocking sources and the per-kind copy/action shape are
 * unit-testable without mounting anything.
 */

export type ComposerBlockedIcon = "alert" | "spinner";
export type ComposerBlockedTone = "destructive" | "faint";
export type ComposerBlockedActionVariant = "primary" | "secondary";

/** An action bound to a live callback — the hook wires these; this module
 * only decides which ones apply, in what order, and under what label. */
export interface ComposerBlockedActionState {
  onSelect: () => void;
  loading: boolean;
  disabled: boolean;
}

export interface ComposerBlockedActionPresentation extends ComposerBlockedActionState {
  key: string;
  label: string;
  variant: ComposerBlockedActionVariant;
}

export interface ComposerBlockedPresentation {
  icon: ComposerBlockedIcon;
  tone: ComposerBlockedTone;
  message: string;
  actions: ComposerBlockedActionPresentation[];
}

// ---------------------------------------------------------------------------
// Domain state — one shape per takeover kind. Built by `resolveComposerBlockedState`
// from the raw per-source inputs below, in source-precedence order.
// ---------------------------------------------------------------------------

export type ComposerBlockedState =
  | {
    kind: "worktree-missing";
    message: string;
    checkAgain: ComposerBlockedActionState;
    restore: ComposerBlockedActionState | null;
  }
  | {
    kind: "provisioning";
    message: string;
  }
  | {
    kind: "provisioning-failed";
    message: string;
    back: ComposerBlockedActionState;
    retry: ComposerBlockedActionState;
  }
  | {
    kind: "cloud-pending";
    message: string;
  }
  | {
    kind: "cloud-attention";
    message: string;
    primaryActionLabel: string | null;
    primaryAction: ComposerBlockedActionState | null;
  }
  | {
    kind: "runtime-connecting";
    message: string;
  }
  | {
    kind: "runtime-error";
    message: string;
    retry: ComposerBlockedActionState | null;
  }
  | {
    kind: "runtime-claim-required";
    message: string;
    claim: ComposerBlockedActionState | null;
  };

// ---------------------------------------------------------------------------
// Raw per-source inputs. The hook populates whichever buckets its underlying
// data supports; at most one of the workspace-status-panel-derived buckets
// (directoryMissing/provisioning/cloudStatus) is non-null at a time (their
// source, use-workspace-status-panel-state, already resolves one kind), but
// `cloudRuntime` is independent, so the resolver still enforces precedence
// explicitly rather than assuming exclusivity.
// ---------------------------------------------------------------------------

export interface ComposerBlockedDirectoryMissingInput {
  workspaceKind: Workspace["kind"];
  restoreEligible: boolean;
  /** Overrides the standard message when the last restore attempt failed. */
  restoreError: string | null;
  checkAgain: ComposerBlockedActionState;
  restore: ComposerBlockedActionState;
}

export interface ComposerBlockedProvisioningInput {
  isFailed: boolean;
  message: string;
  back: ComposerBlockedActionState;
  retry: ComposerBlockedActionState;
}

export interface ComposerBlockedCloudStatusInput {
  mode: CloudWorkspaceStatusScreenMode;
  message: string;
  primaryActionLabel: string | null;
  primaryAction: ComposerBlockedActionState | null;
}

export interface ComposerBlockedCloudRuntimeInput {
  phase: SelectedCloudRuntimePhase;
  message: string;
  retry: ComposerBlockedActionState | null;
  claim: ComposerBlockedActionState | null;
}

export interface ComposerBlockedStateInput {
  directoryMissing: ComposerBlockedDirectoryMissingInput | null;
  provisioning: ComposerBlockedProvisioningInput | null;
  cloudStatus: ComposerBlockedCloudStatusInput | null;
  cloudRuntime: ComposerBlockedCloudRuntimeInput | null;
}

/**
 * Precedence: worktree/local directory missing outranks everything else
 * (nothing about the workspace is actionable while the checkout is gone);
 * then cloud/cowork provisioning; then the richer cloud-status screen; then
 * a live cloud runtime that has dropped out of "ready". This mirrors the
 * retired ambient-slot ordering (workspace-status panel before
 * cloud-runtime panel).
 */
export function resolveComposerBlockedState(
  input: ComposerBlockedStateInput,
): ComposerBlockedState | null {
  if (input.directoryMissing) {
    const { workspaceKind, restoreEligible, restoreError, checkAgain, restore } =
      input.directoryMissing;
    return {
      kind: "worktree-missing",
      message: restoreError ?? missingCheckoutComposerMessage(workspaceKind, restoreEligible),
      checkAgain,
      restore: restoreEligible ? restore : null,
    };
  }

  if (input.provisioning) {
    const { isFailed, message, back, retry } = input.provisioning;
    if (isFailed) {
      return { kind: "provisioning-failed", message, back, retry };
    }
    return { kind: "provisioning", message };
  }

  if (input.cloudStatus) {
    const { mode, message, primaryActionLabel, primaryAction } = input.cloudStatus;
    if (mode === "pending") {
      return { kind: "cloud-pending", message };
    }
    return { kind: "cloud-attention", message, primaryActionLabel, primaryAction };
  }

  if (input.cloudRuntime) {
    const { phase, message, retry, claim } = input.cloudRuntime;
    switch (phase) {
      case "resuming":
        return { kind: "runtime-connecting", message };
      case "claim_required":
        return { kind: "runtime-claim-required", message, claim };
      case "failed":
        return { kind: "runtime-error", message, retry };
      case "ready":
        // The hook never populates this bucket for a ready runtime.
        return null;
    }
  }

  return null;
}

function action(
  key: string,
  label: string,
  variant: ComposerBlockedActionVariant,
  state: ComposerBlockedActionState,
): ComposerBlockedActionPresentation {
  return { key, label, variant, ...state };
}

export function presentComposerBlockedState(
  state: ComposerBlockedState,
): ComposerBlockedPresentation {
  switch (state.kind) {
    case "worktree-missing":
      return {
        icon: "alert",
        tone: "destructive",
        message: state.message,
        actions: [
          action("check-again", "Check again", "secondary", state.checkAgain),
          ...(state.restore ? [action("restore", "Restore worktree", "primary", state.restore)] : []),
        ],
      };
    case "provisioning":
      return { icon: "spinner", tone: "faint", message: state.message, actions: [] };
    case "provisioning-failed":
      return {
        icon: "alert",
        tone: "destructive",
        message: state.message,
        actions: [
          action("back", "Back", "secondary", state.back),
          action("retry", "Retry", "primary", state.retry),
        ],
      };
    case "cloud-pending":
      return { icon: "spinner", tone: "faint", message: state.message, actions: [] };
    case "cloud-attention":
      return {
        icon: "alert",
        tone: "destructive",
        message: state.message,
        actions: state.primaryAction && state.primaryActionLabel
          ? [action("primary", state.primaryActionLabel, "primary", state.primaryAction)]
          : [],
      };
    case "runtime-connecting":
      return { icon: "spinner", tone: "faint", message: state.message, actions: [] };
    case "runtime-error":
      return {
        icon: "alert",
        tone: "destructive",
        message: state.message,
        actions: state.retry ? [action("retry", "Retry", "primary", state.retry)] : [],
      };
    case "runtime-claim-required":
      return {
        icon: "alert",
        tone: "destructive",
        message: state.message,
        actions: state.claim ? [action("claim", "Claim", "primary", state.claim)] : [],
      };
  }
}
