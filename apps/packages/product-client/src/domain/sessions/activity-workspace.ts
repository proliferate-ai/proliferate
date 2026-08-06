import type {
  SessionActivitySnapshot,
  SessionViewState,
  SidebarSessionActivityState,
} from "./activity-types";
import { resolveSessionSidebarActivityState, resolveSessionViewState } from "./activity-status";

interface WorkspaceSessionActivitySnapshot extends SessionActivitySnapshot {
  workspaceId: string | null;
}

interface WorkspaceSessionSidebarAttentionSnapshot extends WorkspaceSessionActivitySnapshot {
  sessionId: string;
  errorAttentionKey: string | null;
}

interface SessionActivityReconciliationSnapshot extends SessionActivitySnapshot {
  sessionId: string;
}

export function sessionSlotBelongsToWorkspace(
  slot: { workspaceId: string | null } | null | undefined,
  workspaceId: string | null | undefined,
): boolean {
  return !!slot && !!workspaceId && slot.workspaceId === workspaceId;
}

export function collectWorkspaceSessionViewStates(
  sessionSlots: Record<string, WorkspaceSessionActivitySnapshot>,
): Record<string, SessionViewState> {
  const states: Record<string, SessionViewState> = {};

  for (const slot of Object.values(sessionSlots)) {
    if (!slot.workspaceId) {
      continue;
    }

    const nextState = resolveSessionViewState(slot);
    const currentState = states[slot.workspaceId];
    if (!currentState || sessionViewStatePriority(nextState) > sessionViewStatePriority(currentState)) {
      states[slot.workspaceId] = nextState;
    }
  }

  return states;
}

export function collectWorkspaceSidebarActivityStates(
  sessionSlots: Record<string, WorkspaceSessionActivitySnapshot>,
): Record<string, SidebarSessionActivityState> {
  const states: Record<string, SidebarSessionActivityState> = {};

  for (const slot of Object.values(sessionSlots)) {
    if (!slot.workspaceId) {
      continue;
    }

    const nextState = resolveSessionSidebarActivityState(slot);
    const currentState = states[slot.workspaceId];
    if (
      !currentState
      || sidebarSessionActivityPriority(nextState) > sidebarSessionActivityPriority(currentState)
    ) {
      states[slot.workspaceId] = nextState;
    }
  }

  return states;
}

export function collectWorkspaceSidebarActivityStatesWithErrorAttention(
  sessionSlots: Record<string, WorkspaceSessionSidebarAttentionSnapshot>,
  lastViewedSessionErrorAtBySession: Record<string, string>,
): Record<string, SidebarSessionActivityState> {
  const states: Record<string, SidebarSessionActivityState> = {};

  for (const slot of Object.values(sessionSlots)) {
    if (!slot.workspaceId) {
      continue;
    }

    const nextState = resolveSessionSidebarActivityState(slot);
    const attentionState =
      nextState === "error"
        && slot.errorAttentionKey !== null
        && lastViewedSessionErrorAtBySession[slot.sessionId] === slot.errorAttentionKey
        ? "idle"
        : nextState;
    const currentState = states[slot.workspaceId];
    if (
      !currentState
      || sidebarSessionActivityPriority(attentionState) > sidebarSessionActivityPriority(currentState)
    ) {
      states[slot.workspaceId] = attentionState;
    }
  }

  return states;
}

export function collectSessionActivityReconciliationIds(
  sessionSlots: Record<string, SessionActivityReconciliationSnapshot>,
): string[] {
  const ids: string[] = [];

  for (const slot of Object.values(sessionSlots)) {
    const sidebarState = resolveSessionSidebarActivityState(slot);
    if (
      sidebarState === "iterating"
      || sidebarState === "waiting_input"
      || sidebarState === "waiting_plan"
    ) {
      ids.push(slot.sessionId);
    }
  }

  return ids.sort();
}

function sessionViewStatePriority(state: SessionViewState): number {
  switch (state) {
    case "needs_input":
      return 4;
    case "working":
      return 3;
    case "errored":
      return 2;
    case "closed":
      return 1;
    case "idle":
    default:
      return 0;
  }
}

function sidebarSessionActivityPriority(state: SidebarSessionActivityState): number {
  switch (state) {
    case "error":
      return 5;
    case "waiting_input":
      return 4;
    case "waiting_plan":
      return 3;
    case "iterating":
      return 2;
    case "closed":
      return 1;
    case "idle":
    default:
      return 0;
  }
}
