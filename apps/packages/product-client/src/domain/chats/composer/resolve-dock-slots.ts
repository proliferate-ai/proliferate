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
  | { kind: "mcp_elicitation" }
  | { kind: "todo_tracker" };

/**
 * Slim companion rendered directly below the active interaction card so plan
 * progress is not evicted entirely while a permission/question/MCP form
 * holds the dock's single active slot.
 */
export type ComposerDockActiveSlotCompanion = { kind: "todo_strip" };

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
  activeSlotCompanion: ComposerDockActiveSlotCompanion | null;
  attachedSlot: ComposerDockAttachedSlot | null;
}

export interface ResolveComposerDockSlotsInput {
  suppressSessionSlots?: boolean;
  pendingPromptCount: number;
  recoveredPromptCount?: number;
  primaryPendingInteractionKind: ComposerDockInteractionKind | null;
  hasActiveTodoTracker: boolean;
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
  hasActiveTodoTracker,
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
    ? resolveActiveSlot(primaryPendingInteractionKind, hasActiveTodoTracker)
    : null;
  const activeSlotCompanion =
    activeSlot && activeSlot.kind !== "todo_tracker" && hasActiveTodoTracker
      ? { kind: "todo_strip" as const }
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
    activeSlotCompanion,
    attachedSlot,
  };
}

function resolveActiveSlot(
  primaryPendingInteractionKind: ComposerDockInteractionKind | null,
  hasActiveTodoTracker: boolean,
): ComposerDockActiveSlot | null {
  if (primaryPendingInteractionKind) {
    return { kind: primaryPendingInteractionKind };
  }
  return hasActiveTodoTracker ? { kind: "todo_tracker" } : null;
}
