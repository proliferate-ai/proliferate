import { sessionSlotBelongsToWorkspace } from "@/lib/domain/sessions/activity";
import { resolveWorkspaceUiKey } from "@/lib/domain/workspaces/selection/workspace-ui-key";
import { rememberLastViewedSession } from "@/stores/preferences/workspace-ui-store";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import type { HotPaintGate } from "@/stores/sessions/session-types";

export type SessionActivationStaleReason =
  | "workspace-changed"
  | "intent-replaced"
  | "slot-missing"
  | "slot-workspace-mismatch"
  | "selection-replaced"
  | "model-remediation";

export interface SessionActivationGuard {
  workspaceId: string;
  workspaceSelectionNonce: number;
  token: number;
}

export type SessionActivationOutcome =
  | {
      result: "completed";
      sessionId: string;
      guard: SessionActivationGuard;
      activeSessionVersion: number;
    }
  | {
      result: "stale";
      sessionId: string | null;
      guard: SessionActivationGuard;
      reason: SessionActivationStaleReason;
    };

export type ClearActiveSessionOutcome =
  | { result: "cleared"; activeSessionVersion: number }
  | { result: "noop"; activeSessionVersion: number }
  | { result: "stale"; activeSessionVersion: number };

export function beginSessionActivationIntent(workspaceId: string): SessionActivationGuard {
  const state = useSessionSelectionStore.getState();
  return {
    workspaceId,
    workspaceSelectionNonce: state.workspaceSelectionNonce,
    token: state.bumpSessionActivationIntentEpoch(workspaceId),
  };
}

export function invalidateSessionActivationIntent(workspaceId: string): {
  workspaceId: string;
  epoch: number;
} {
  return {
    workspaceId,
    epoch: useSessionSelectionStore.getState().bumpSessionActivationIntentEpoch(workspaceId),
  };
}

export function isSessionActivationCurrent(guard: SessionActivationGuard): boolean {
  const state = useSessionSelectionStore.getState();
  return state.selectedWorkspaceId === guard.workspaceId
    && state.workspaceSelectionNonce === guard.workspaceSelectionNonce
    && (state.sessionActivationIntentEpochByWorkspace[guard.workspaceId] ?? 0) === guard.token;
}

export function commitActiveSession(
  sessionId: string,
  guard: SessionActivationGuard,
): SessionActivationOutcome {
  const state = useSessionSelectionStore.getState();
  if (state.selectedWorkspaceId !== guard.workspaceId) {
    return { result: "stale", sessionId, guard, reason: "workspace-changed" };
  }
  if (state.workspaceSelectionNonce !== guard.workspaceSelectionNonce) {
    return { result: "stale", sessionId, guard, reason: "selection-replaced" };
  }
  if ((state.sessionActivationIntentEpochByWorkspace[guard.workspaceId] ?? 0) !== guard.token) {
    return { result: "stale", sessionId, guard, reason: "intent-replaced" };
  }
  const entry = useSessionDirectoryStore.getState().entriesById[sessionId] ?? null;
  if (!entry) {
    return { result: "stale", sessionId, guard, reason: "slot-missing" };
  }
  if (!sessionSlotBelongsToWorkspace(entry, guard.workspaceId)) {
    return { result: "stale", sessionId, guard, reason: "slot-workspace-mismatch" };
  }
  state.setActiveSessionId(sessionId);
  if (entry.materializedSessionId) {
    rememberLastViewedSession(
      resolveWorkspaceUiKey(
        useSessionSelectionStore.getState().selectedLogicalWorkspaceId,
        guard.workspaceId,
      ) ?? guard.workspaceId,
      entry.materializedSessionId,
    );
  }
  return {
    result: "completed",
    sessionId,
    guard,
    activeSessionVersion: useSessionSelectionStore.getState().activeSessionVersion,
  };
}

export function commitHotActiveSession(
  sessionId: string,
  guard: SessionActivationGuard,
  hotPaintGate: HotPaintGate,
): SessionActivationOutcome {
  const state = useSessionSelectionStore.getState();
  if (state.selectedWorkspaceId !== guard.workspaceId) {
    return { result: "stale", sessionId, guard, reason: "workspace-changed" };
  }
  if (state.workspaceSelectionNonce !== guard.workspaceSelectionNonce) {
    return { result: "stale", sessionId, guard, reason: "selection-replaced" };
  }
  if ((state.sessionActivationIntentEpochByWorkspace[guard.workspaceId] ?? 0) !== guard.token) {
    return { result: "stale", sessionId, guard, reason: "intent-replaced" };
  }
  const entry = useSessionDirectoryStore.getState().entriesById[sessionId] ?? null;
  if (!entry) {
    return { result: "stale", sessionId, guard, reason: "slot-missing" };
  }
  if (!sessionSlotBelongsToWorkspace(entry, guard.workspaceId)) {
    return { result: "stale", sessionId, guard, reason: "slot-workspace-mismatch" };
  }
  state.activateHotSession({
    sessionId,
    workspaceId: guard.workspaceId,
    hotPaintGate,
  });
  if (entry.materializedSessionId) {
    rememberLastViewedSession(
      resolveWorkspaceUiKey(
        useSessionSelectionStore.getState().selectedLogicalWorkspaceId,
        guard.workspaceId,
      ) ?? guard.workspaceId,
      entry.materializedSessionId,
    );
  }
  return {
    result: "completed",
    sessionId,
    guard,
    activeSessionVersion: useSessionSelectionStore.getState().activeSessionVersion,
  };
}

export function clearActiveSession(
  workspaceId: string,
  guard?: SessionActivationGuard,
): ClearActiveSessionOutcome {
  if (guard && !isSessionActivationCurrent(guard)) {
    return {
      result: "stale",
      activeSessionVersion: useSessionSelectionStore.getState().activeSessionVersion,
    };
  }
  const state = useSessionSelectionStore.getState();
  const activeSessionId = state.activeSessionId;
  const entry = activeSessionId
    ? useSessionDirectoryStore.getState().entriesById[activeSessionId] ?? null
    : null;
  if (!activeSessionId || !sessionSlotBelongsToWorkspace(entry, workspaceId)) {
    return { result: "noop", activeSessionVersion: state.activeSessionVersion };
  }
  state.setActiveSessionId(null);
  return {
    result: "cleared",
    activeSessionVersion: useSessionSelectionStore.getState().activeSessionVersion,
  };
}
