import { sessionSlotBelongsToWorkspace } from "@/lib/domain/sessions/activity";
import { resolveWorkspaceUiKey } from "@/lib/domain/workspaces/workspace-ui-key";
import { rememberLastViewedSession } from "@/stores/preferences/workspace-ui-store";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useLogicalWorkspaceStore } from "@/stores/workspaces/logical-workspace-store";

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
  const state = useHarnessStore.getState();
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
    epoch: useHarnessStore.getState().bumpSessionActivationIntentEpoch(workspaceId),
  };
}

export function isSessionActivationCurrent(guard: SessionActivationGuard): boolean {
  const state = useHarnessStore.getState();
  return state.selectedWorkspaceId === guard.workspaceId
    && state.workspaceSelectionNonce === guard.workspaceSelectionNonce
    && (state.sessionActivationIntentEpochByWorkspace[guard.workspaceId] ?? 0) === guard.token;
}

export function commitActiveSession(
  sessionId: string,
  guard: SessionActivationGuard,
): SessionActivationOutcome {
  const state = useHarnessStore.getState();
  if (state.selectedWorkspaceId !== guard.workspaceId) {
    return { result: "stale", sessionId, guard, reason: "workspace-changed" };
  }
  if (state.workspaceSelectionNonce !== guard.workspaceSelectionNonce) {
    return { result: "stale", sessionId, guard, reason: "selection-replaced" };
  }
  if ((state.sessionActivationIntentEpochByWorkspace[guard.workspaceId] ?? 0) !== guard.token) {
    return { result: "stale", sessionId, guard, reason: "intent-replaced" };
  }
  const slot = state.sessionSlots[sessionId] ?? null;
  if (!slot) {
    return { result: "stale", sessionId, guard, reason: "slot-missing" };
  }
  if (!sessionSlotBelongsToWorkspace(slot, guard.workspaceId)) {
    return { result: "stale", sessionId, guard, reason: "slot-workspace-mismatch" };
  }
  state.setActiveSessionId(sessionId);
  rememberLastViewedSession(
    resolveWorkspaceUiKey(
      useLogicalWorkspaceStore.getState().selectedLogicalWorkspaceId,
      guard.workspaceId,
    ) ?? guard.workspaceId,
    sessionId,
  );
  return {
    result: "completed",
    sessionId,
    guard,
    activeSessionVersion: useHarnessStore.getState().activeSessionVersion,
  };
}

export function clearActiveSession(
  workspaceId: string,
  guard?: SessionActivationGuard,
): ClearActiveSessionOutcome {
  if (guard && !isSessionActivationCurrent(guard)) {
    return {
      result: "stale",
      activeSessionVersion: useHarnessStore.getState().activeSessionVersion,
    };
  }
  const state = useHarnessStore.getState();
  const activeSessionId = state.activeSessionId;
  const slot = activeSessionId ? state.sessionSlots[activeSessionId] ?? null : null;
  if (!activeSessionId || !sessionSlotBelongsToWorkspace(slot, workspaceId)) {
    return { result: "noop", activeSessionVersion: state.activeSessionVersion };
  }
  state.setActiveSessionId(null);
  return {
    result: "cleared",
    activeSessionVersion: useHarnessStore.getState().activeSessionVersion,
  };
}
