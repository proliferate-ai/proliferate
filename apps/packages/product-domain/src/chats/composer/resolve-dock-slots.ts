export type ComposerDockInteractionKind =
  | "permission"
  | "user_input"
  | "mcp_elicitation";

export type ComposerDockOutboundSlot = {
  kind: "pending_prompts";
};

export type ComposerDockActiveSlot =
  | { kind: "permission" }
  | { kind: "user_input" }
  | { kind: "mcp_elicitation" }
  | { kind: "todo_tracker" };

export type ComposerDockAmbientSlot =
  | { kind: "workspace_status" }
  | { kind: "cloud_runtime" };

/**
 * Slim companion rendered directly below the active interaction card so plan
 * progress is not evicted entirely while a permission/question/MCP form
 * holds the dock's single active slot.
 */
export type ComposerDockActiveSlotCompanion = { kind: "todo_strip" };

export interface ComposerDockAttachedSlot {
  ambientSlot: ComposerDockAmbientSlot | null;
  delegatedWork: boolean;
}

export interface ComposerDockSlotResolution {
  outboundSlot: ComposerDockOutboundSlot | null;
  activeSlot: ComposerDockActiveSlot | null;
  activeSlotCompanion: ComposerDockActiveSlotCompanion | null;
  attachedSlot: ComposerDockAttachedSlot | null;
}

export interface ResolveComposerDockSlotsInput {
  suppressSessionSlots?: boolean;
  suppressWorkspaceStatusPanels?: boolean;
  pendingPromptCount: number;
  primaryPendingInteractionKind: ComposerDockInteractionKind | null;
  hasActiveTodoTracker: boolean;
  hasDelegatedWork: boolean;
  hasWorkspaceStatusPanel: boolean;
  hasCloudRuntimePanel: boolean;
}

export function resolveComposerDockSlots({
  suppressSessionSlots = false,
  suppressWorkspaceStatusPanels = false,
  pendingPromptCount,
  primaryPendingInteractionKind,
  hasActiveTodoTracker,
  hasDelegatedWork,
  hasWorkspaceStatusPanel,
  hasCloudRuntimePanel,
}: ResolveComposerDockSlotsInput): ComposerDockSlotResolution {
  const outboundSlot =
    !suppressSessionSlots && pendingPromptCount > 0
      ? { kind: "pending_prompts" as const }
      : null;
  const activeSlot = !suppressSessionSlots
    ? resolveActiveSlot(primaryPendingInteractionKind, hasActiveTodoTracker)
    : null;
  const activeSlotCompanion =
    activeSlot && activeSlot.kind !== "todo_tracker" && hasActiveTodoTracker
      ? { kind: "todo_strip" as const }
      : null;
  const ambientSlot = !suppressWorkspaceStatusPanels
    ? resolveAmbientSlot(hasWorkspaceStatusPanel, hasCloudRuntimePanel)
    : null;
  const attachedDelegatedWork = !suppressSessionSlots && hasDelegatedWork;
  const attachedSlot =
    ambientSlot || attachedDelegatedWork
      ? {
        ambientSlot,
        delegatedWork: attachedDelegatedWork,
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

function resolveAmbientSlot(
  hasWorkspaceStatusPanel: boolean,
  hasCloudRuntimePanel: boolean,
): ComposerDockAmbientSlot | null {
  if (hasWorkspaceStatusPanel) {
    return { kind: "workspace_status" };
  }
  return hasCloudRuntimePanel ? { kind: "cloud_runtime" } : null;
}
