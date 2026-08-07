import { describe, expect, it } from "vitest";
import {
  composeBlockedStatusMessage,
  presentComposerBlockedState,
  resolveComposerBlockedState,
  type ComposerBlockedActionState,
  type ComposerBlockedStateInput,
} from "./composer-blocked-state";

function action(overrides: Partial<ComposerBlockedActionState> = {}): ComposerBlockedActionState {
  return { onSelect: () => {}, loading: false, disabled: false, ...overrides };
}

const EMPTY_INPUT: ComposerBlockedStateInput = {
  directoryMissing: null,
  provisioningFailed: null,
  cloudStatus: null,
  cloudRuntime: null,
};

describe("resolveComposerBlockedState", () => {
  it("returns null when nothing is blocking", () => {
    expect(resolveComposerBlockedState(EMPTY_INPUT)).toBeNull();
  });

  it("prioritizes a missing directory over every other source", () => {
    const state = resolveComposerBlockedState({
      ...EMPTY_INPUT,
      directoryMissing: {
        workspaceKind: "worktree",
        restoreEligible: true,
        restoreError: null,
        checkAgain: action(),
        restore: action(),
      },
      provisioningFailed: { message: "provisioning failed", back: action(), retry: action() },
      cloudStatus: { mode: "pending", message: "cloud", primaryActionLabel: null, primaryAction: null, primaryActionConfirmation: null },
      cloudRuntime: { phase: "failed", message: "runtime", retry: action(), claim: null },
    });
    expect(state?.kind).toBe("worktree-missing");
  });

  it("prioritizes failed provisioning over cloud status and cloud runtime", () => {
    const state = resolveComposerBlockedState({
      ...EMPTY_INPUT,
      provisioningFailed: { message: "provisioning failed", back: action(), retry: action() },
      cloudStatus: { mode: "pending", message: "cloud", primaryActionLabel: null, primaryAction: null, primaryActionConfirmation: null },
      cloudRuntime: { phase: "failed", message: "runtime", retry: action(), claim: null },
    });
    expect(state?.kind).toBe("provisioning-failed");
  });

  it("prioritizes cloud status over cloud runtime", () => {
    const state = resolveComposerBlockedState({
      ...EMPTY_INPUT,
      cloudStatus: { mode: "pending", message: "cloud", primaryActionLabel: null, primaryAction: null, primaryActionConfirmation: null },
      cloudRuntime: { phase: "failed", message: "runtime", retry: action(), claim: null },
    });
    expect(state?.kind).toBe("cloud-pending");
  });

  it("falls back to cloud runtime when nothing else is blocking", () => {
    const state = resolveComposerBlockedState({
      ...EMPTY_INPUT,
      cloudRuntime: { phase: "failed", message: "runtime", retry: action(), claim: null },
    });
    expect(state?.kind).toBe("runtime-error");
  });

  describe("directoryMissing", () => {
    it("maps a restore-eligible directory to worktree-missing with both actions", () => {
      const checkAgain = action();
      const restore = action();
      const state = resolveComposerBlockedState({
        ...EMPTY_INPUT,
        directoryMissing: {
          workspaceKind: "worktree",
          restoreEligible: true,
          restoreError: null,
          checkAgain,
          restore,
        },
      });
      expect(state).toEqual({
        kind: "worktree-missing",
        message: "Worktree folder is missing. Chat is paused until it’s restored.",
        checkAgain,
        restore,
      });
    });

    it("drops the restore action when the workspace is not restore-eligible", () => {
      const state = resolveComposerBlockedState({
        ...EMPTY_INPUT,
        directoryMissing: {
          workspaceKind: "local",
          restoreEligible: false,
          restoreError: null,
          checkAgain: action(),
          restore: action(),
        },
      });
      expect(state?.kind).toBe("worktree-missing");
      expect(state && "restore" in state ? state.restore : undefined).toBeNull();
    });

    it("overrides the message with the last restore error", () => {
      const state = resolveComposerBlockedState({
        ...EMPTY_INPUT,
        directoryMissing: {
          workspaceKind: "worktree",
          restoreEligible: true,
          restoreError: "Restore failed: permission denied",
          checkAgain: action(),
          restore: action(),
        },
      });
      expect(state?.kind).toBe("worktree-missing");
      expect(state && "message" in state ? state.message : undefined).toBe("Restore failed: permission denied");
    });
  });

  describe("provisioningFailed", () => {
    // In-flight (non-failed) provisioning is deliberately absent from the
    // input shape: the composer stays enabled so a first prompt can queue
    // against the pending workspace, so there is nothing to resolve.
    it("maps failed provisioning with back/retry actions", () => {
      const back = action();
      const retry = action();
      const state = resolveComposerBlockedState({
        ...EMPTY_INPUT,
        provisioningFailed: { message: "Setup failed", back, retry },
      });
      expect(state).toEqual({ kind: "provisioning-failed", message: "Setup failed", back, retry });
    });
  });

  describe("cloudStatus", () => {
    it("maps pending mode without actions", () => {
      const state = resolveComposerBlockedState({
        ...EMPTY_INPUT,
        cloudStatus: { mode: "pending", message: "Preparing runtime", primaryActionLabel: "Retry", primaryAction: action(), primaryActionConfirmation: null },
      });
      expect(state).toEqual({ kind: "cloud-pending", message: "Preparing runtime" });
    });

    it("maps non-pending modes to cloud-attention with the primary action", () => {
      const primaryAction = action();
      const state = resolveComposerBlockedState({
        ...EMPTY_INPUT,
        cloudStatus: { mode: "error", message: "Cloud setup failed", primaryActionLabel: "Retry", primaryAction, primaryActionConfirmation: null },
      });
      expect(state).toEqual({
        kind: "cloud-attention",
        message: "Cloud setup failed",
        primaryActionLabel: "Retry",
        primaryAction,
        primaryActionConfirmation: null,
      });
    });

    it("carries the delete confirmation through to cloud-attention", () => {
      const confirmation = {
        title: "Delete lost workspace?",
        description: "Remove this workspace record.",
        confirmLabel: "Delete",
      };
      const state = resolveComposerBlockedState({
        ...EMPTY_INPUT,
        cloudStatus: { mode: "lost", message: "Workspace lost", primaryActionLabel: "Delete", primaryAction: action(), primaryActionConfirmation: confirmation },
      });
      expect(state && "primaryActionConfirmation" in state ? state.primaryActionConfirmation : null)
        .toEqual(confirmation);
    });
  });

  describe("cloudRuntime", () => {
    it("maps resuming to runtime-connecting", () => {
      const state = resolveComposerBlockedState({
        ...EMPTY_INPUT,
        cloudRuntime: { phase: "resuming", message: "Reconnecting", retry: null, claim: null },
      });
      expect(state).toEqual({ kind: "runtime-connecting", message: "Reconnecting" });
    });

    it("maps claim_required to runtime-claim-required", () => {
      const claim = action();
      const state = resolveComposerBlockedState({
        ...EMPTY_INPUT,
        cloudRuntime: { phase: "claim_required", message: "Shared workspace unclaimed", retry: null, claim },
      });
      expect(state).toEqual({ kind: "runtime-claim-required", message: "Shared workspace unclaimed", claim });
    });

    it("maps failed to runtime-error", () => {
      const retry = action();
      const state = resolveComposerBlockedState({
        ...EMPTY_INPUT,
        cloudRuntime: { phase: "failed", message: "Couldn't reconnect", retry, claim: null },
      });
      expect(state).toEqual({ kind: "runtime-error", message: "Couldn't reconnect", retry });
    });

    it("treats ready as unblocked", () => {
      const state = resolveComposerBlockedState({
        ...EMPTY_INPUT,
        cloudRuntime: { phase: "ready", message: "irrelevant", retry: null, claim: null },
      });
      expect(state).toBeNull();
    });
  });
});

describe("presentComposerBlockedState", () => {
  it("presents worktree-missing with check-again then restore, alert/destructive", () => {
    const checkAgain = action();
    const restore = action();
    const presentation = presentComposerBlockedState({
      kind: "worktree-missing",
      message: "Worktree folder is missing.",
      checkAgain,
      restore,
    });
    expect(presentation.icon).toBe("alert");
    expect(presentation.tone).toBe("destructive");
    expect(presentation.actions.map((a) => a.key)).toEqual(["check-again", "restore"]);
    expect(presentation.actions[0]).toMatchObject({ label: "Check again", variant: "secondary" });
    expect(presentation.actions[1]).toMatchObject({ label: "Restore worktree", variant: "primary" });
  });

  it("presents worktree-missing with only check-again when restore is null", () => {
    const presentation = presentComposerBlockedState({
      kind: "worktree-missing",
      message: "Worktree folder is missing.",
      checkAgain: action(),
      restore: null,
    });
    expect(presentation.actions.map((a) => a.key)).toEqual(["check-again"]);
  });

  it("presents provisioning-failed with back then retry, alert/destructive", () => {
    const back = action();
    const retry = action();
    const presentation = presentComposerBlockedState({
      kind: "provisioning-failed",
      message: "Setup failed",
      back,
      retry,
    });
    expect(presentation.icon).toBe("alert");
    expect(presentation.tone).toBe("destructive");
    expect(presentation.actions.map((a) => a.key)).toEqual(["back", "retry"]);
    expect(presentation.actions[0].variant).toBe("secondary");
    expect(presentation.actions[1].variant).toBe("primary");
  });

  it("presents cloud-pending as a faint spinner with no actions", () => {
    const presentation = presentComposerBlockedState({ kind: "cloud-pending", message: "Preparing runtime" });
    expect(presentation).toEqual({
      icon: "spinner",
      tone: "faint",
      message: "Preparing runtime",
      actions: [],
    });
  });

  it("presents cloud-attention with the model's primary action as the sole action", () => {
    const primaryAction = action();
    const presentation = presentComposerBlockedState({
      kind: "cloud-attention",
      message: "Cloud usage is paused",
      primaryActionLabel: "Try again",
      primaryAction,
      primaryActionConfirmation: null,
    });
    expect(presentation.icon).toBe("alert");
    expect(presentation.tone).toBe("destructive");
    expect(presentation.actions).toEqual([
      { key: "primary", label: "Try again", variant: "primary", confirmation: null, ...primaryAction },
    ]);
  });

  it("presents cloud-attention with no actions when there is no primary action", () => {
    const presentation = presentComposerBlockedState({
      kind: "cloud-attention",
      message: "Workspace archived",
      primaryActionLabel: null,
      primaryAction: null,
      primaryActionConfirmation: null,
    });
    expect(presentation.actions).toEqual([]);
  });

  it("presents runtime-connecting as a faint spinner with no actions", () => {
    const presentation = presentComposerBlockedState({ kind: "runtime-connecting", message: "Reconnecting" });
    expect(presentation).toEqual({
      icon: "spinner",
      tone: "faint",
      message: "Reconnecting",
      actions: [],
    });
  });

  it("presents runtime-error with a retry action when present", () => {
    const retry = action();
    const presentation = presentComposerBlockedState({
      kind: "runtime-error",
      message: "Couldn't reconnect",
      retry,
    });
    expect(presentation.icon).toBe("alert");
    expect(presentation.tone).toBe("destructive");
    expect(presentation.actions).toEqual([{ key: "retry", label: "Retry", variant: "primary", confirmation: null, ...retry }]);
  });

  it("presents runtime-error with no actions when retry is null", () => {
    const presentation = presentComposerBlockedState({
      kind: "runtime-error",
      message: "Couldn't reconnect",
      retry: null,
    });
    expect(presentation.actions).toEqual([]);
  });

  it("presents runtime-claim-required with a claim action when present", () => {
    const claim = action();
    const presentation = presentComposerBlockedState({
      kind: "runtime-claim-required",
      message: "Shared workspace unclaimed",
      claim,
    });
    expect(presentation.icon).toBe("alert");
    expect(presentation.tone).toBe("destructive");
    expect(presentation.actions).toEqual([{ key: "claim", label: "Claim", variant: "primary", confirmation: null, ...claim }]);
  });

  it("presents runtime-claim-required with no actions when claim is null", () => {
    const presentation = presentComposerBlockedState({
      kind: "runtime-claim-required",
      message: "Shared workspace unclaimed",
      claim: null,
    });
    expect(presentation.actions).toEqual([]);
  });
});

describe("composeBlockedStatusMessage", () => {
  it("frames attention descriptions with the title", () => {
    expect(composeBlockedStatusMessage(
      "error",
      "Provisioning failed",
      "exit code 1",
    )).toBe("Provisioning failed. exit code 1");
  });

  it("drops the title while pending or absent", () => {
    expect(composeBlockedStatusMessage("pending", "Ready soon", "Preparing.")).toBe("Preparing.");
    expect(composeBlockedStatusMessage("error", null, "Preparing.")).toBe("Preparing.");
  });

  it("does not double up when the description already restates the title", () => {
    expect(composeBlockedStatusMessage(
      "blocked",
      "Cloud usage is paused",
      "Cloud usage is paused because your included sandbox hours are exhausted.",
    )).toBe("Cloud usage is paused because your included sandbox hours are exhausted.");
  });
});
