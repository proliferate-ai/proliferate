export type ComposerDockInteractionKind =
  | "permission"
  | "user_input"
  | "mcp_elicitation";

export type ComposerDockOutboundSlot =
  | { kind: "pending_prompts" }
  | { kind: "prompt_recoveries" };

export type ComposerDockActiveSlot =
  | { kind: "permission" }
  | { kind: "user_input" }
  | { kind: "mcp_elicitation" };

export interface ComposerDockAttachedSlot {
  delegatedWork: boolean;
  workspaceActivity: boolean;
  /**
   * Session goal bar — ever-present ambient context while goal state is live.
   * The compact activity chips that used to stack on this same bar row
   * (loops/terminals/agents) retired into `BackgroundWorkPane`'s roster and
   * the transcript-tail row (Design Handoff — HANDOFF-background-work.md,
   * MODIFIED `SessionActivityBar`); the bar now mounts on goal state alone.
   */
  sessionGoal: boolean;
}

export interface ComposerDockSlotResolution {
  outboundSlot: ComposerDockOutboundSlot | null;
  activeSlot: ComposerDockActiveSlot | null;
  attachedSlot: ComposerDockAttachedSlot | null;
}

export interface ResolveComposerDockSlotsInput {
  suppressSessionSlots?: boolean;
  pendingPromptCount: number;
  recoveredPromptCount?: number;
  primaryPendingInteractionKind: ComposerDockInteractionKind | null;
  hasDelegatedWork: boolean;
  hasWorkspaceActivity: boolean;
  hasSessionGoal: boolean;
}

export function resolveComposerDockSlots({
  suppressSessionSlots = false,
  pendingPromptCount,
  recoveredPromptCount = 0,
  primaryPendingInteractionKind,
  hasDelegatedWork,
  hasWorkspaceActivity,
  hasSessionGoal,
}: ResolveComposerDockSlotsInput): ComposerDockSlotResolution {
  const outboundSlot = !suppressSessionSlots && recoveredPromptCount > 0
    ? { kind: "prompt_recoveries" as const }
    : !suppressSessionSlots && pendingPromptCount > 0
      ? { kind: "pending_prompts" as const }
      : null;
  const activeSlot = !suppressSessionSlots
    ? resolveActiveSlot(primaryPendingInteractionKind)
    : null;
  const attachedDelegatedWork = !suppressSessionSlots && hasDelegatedWork;
  const attachedWorkspaceActivity = hasWorkspaceActivity;
  const attachedSessionGoal = !suppressSessionSlots && hasSessionGoal;
  const attachedSlot =
    attachedDelegatedWork
    || attachedWorkspaceActivity
    || attachedSessionGoal
      ? {
        delegatedWork: attachedDelegatedWork,
        workspaceActivity: attachedWorkspaceActivity,
        sessionGoal: attachedSessionGoal,
      }
      : null;

  return {
    outboundSlot,
    activeSlot,
    attachedSlot,
  };
}

function resolveActiveSlot(
  primaryPendingInteractionKind: ComposerDockInteractionKind | null,
): ComposerDockActiveSlot | null {
  return primaryPendingInteractionKind ? { kind: primaryPendingInteractionKind } : null;
}
