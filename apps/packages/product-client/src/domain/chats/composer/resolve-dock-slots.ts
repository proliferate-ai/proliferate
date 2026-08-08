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
   */
  sessionGoal: boolean;
  /**
   * Compact activity chips (loops/terminals/agents) that stack on the same
   * bar row as the goal (session-activity-architecture §Locked decisions
   * #5). Independent from `sessionGoal` — activity can be live with no goal
   * set, so the bar must still mount.
   */
  sessionActivity: boolean;
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
  hasSessionActivity?: boolean;
}

export function resolveComposerDockSlots({
  suppressSessionSlots = false,
  pendingPromptCount,
  recoveredPromptCount = 0,
  primaryPendingInteractionKind,
  hasDelegatedWork,
  hasWorkspaceActivity,
  hasSessionGoal,
  hasSessionActivity = false,
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
  const attachedSessionActivity = !suppressSessionSlots && hasSessionActivity;
  const attachedSlot =
    attachedDelegatedWork
    || attachedWorkspaceActivity
    || attachedSessionGoal
    || attachedSessionActivity
      ? {
        delegatedWork: attachedDelegatedWork,
        workspaceActivity: attachedWorkspaceActivity,
        sessionGoal: attachedSessionGoal,
        sessionActivity: attachedSessionActivity,
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
