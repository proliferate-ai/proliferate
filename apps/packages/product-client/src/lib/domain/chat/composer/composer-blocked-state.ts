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

/** Confirmation dialog copy for an irreversible action; the control row
 * interposes a `ConfirmationDialog` before `onSelect` runs. */
export interface ComposerBlockedActionConfirmation {
  title: string;
  description: string;
  confirmLabel: string;
}

export interface ComposerBlockedActionPresentation extends ComposerBlockedActionState {
  key: string;
  label: string;
  variant: ComposerBlockedActionVariant;
  confirmation: ComposerBlockedActionConfirmation | null;
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
    /** Present when the primary action is irreversible (lost-workspace
     * delete) and must be confirmed before it fires. */
    primaryActionConfirmation: ComposerBlockedActionConfirmation | null;
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
// (directoryMissing/provisioningFailed/cloudStatus) is non-null at a time (their
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

/** Populated only for a FAILED pending entry. In-flight provisioning is
 * deliberately not a takeover: availability keeps the composer enabled so
 * the first prompt can be typed and queued against the pending workspace
 * (design rule: non-blocking ambient states never take over the composer). */
export interface ComposerBlockedProvisioningFailedInput {
  message: string;
  back: ComposerBlockedActionState;
  retry: ComposerBlockedActionState;
}

export interface ComposerBlockedCloudStatusInput {
  mode: CloudWorkspaceStatusScreenMode;
  message: string;
  primaryActionLabel: string | null;
  primaryAction: ComposerBlockedActionState | null;
  primaryActionConfirmation: ComposerBlockedActionConfirmation | null;
}

export interface ComposerBlockedCloudRuntimeInput {
  phase: SelectedCloudRuntimePhase;
  message: string;
  retry: ComposerBlockedActionState | null;
  claim: ComposerBlockedActionState | null;
}

export interface ComposerBlockedStateInput {
  directoryMissing: ComposerBlockedDirectoryMissingInput | null;
  provisioningFailed: ComposerBlockedProvisioningFailedInput | null;
  cloudStatus: ComposerBlockedCloudStatusInput | null;
  cloudRuntime: ComposerBlockedCloudRuntimeInput | null;
}

/**
 * Precedence: the workspace-status-panel-derived buckets first (their
 * source, use-workspace-status-panel-state, already yields at most one of
 * directoryMissing/provisioningFailed/cloudStatus — a pending entry
 * resolves before a missing directory there, so the relative order of the
 * first three arms is a tiebreak that cannot fire in practice), then a live
 * cloud runtime that has dropped out of "ready". This mirrors the retired
 * ambient-slot ordering (workspace-status panel before cloud-runtime
 * panel).
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

  if (input.provisioningFailed) {
    const { message, back, retry } = input.provisioningFailed;
    return { kind: "provisioning-failed", message, back, retry };
  }

  if (input.cloudStatus) {
    const { mode, message, primaryActionLabel, primaryAction, primaryActionConfirmation } =
      input.cloudStatus;
    if (mode === "pending") {
      return { kind: "cloud-pending", message };
    }
    return {
      kind: "cloud-attention",
      message,
      primaryActionLabel,
      primaryAction,
      primaryActionConfirmation,
    };
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
  confirmation: ComposerBlockedActionConfirmation | null = null,
): ComposerBlockedActionPresentation {
  return { key, label, variant, confirmation, ...state };
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
          ? [action(
            "primary",
            state.primaryActionLabel,
            "primary",
            state.primaryAction,
            state.primaryActionConfirmation,
          )]
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
