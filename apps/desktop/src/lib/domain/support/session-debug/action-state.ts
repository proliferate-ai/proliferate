import type { HealthResponse } from "@anyharness/sdk";
import type { SessionDirectoryEntry } from "@/lib/domain/sessions/directory/directory-entry";
import {
  buildSessionDebugLocator,
  type SessionDebugLocator,
  type SessionDebugRuntimeLocation,
} from "@/lib/domain/support/session-debug/locator";
import type { SessionDebugLocatorSession } from "@/lib/domain/support/session-debug/session-summary";

export type SessionDebugActionSessionRecord = Pick<
  SessionDirectoryEntry,
  | "actionCapabilities"
  | "agentKind"
  | "materializedSessionId"
  | "modeId"
  | "modelId"
  | "sessionId"
  | "status"
  | "title"
  | "workspaceId"
>;

export interface SessionDebugActionState {
  runtimeUrl: string;
  selectedWorkspaceId: string | null;
  selectedLogicalWorkspaceId: string | null;
  activeSessionId: string | null;
  sessionRecords: Record<string, SessionDebugActionSessionRecord>;
}

export interface SessionDebugActionAvailability {
  activeSessionWorkspaceId: string | null;
  canCopyInvestigationJson: boolean;
  canExportActiveSessionJson: boolean;
  canExportReplayRecording: boolean;
  canExportWorkspaceJson: boolean;
}

export interface PlanSessionDebugActionAvailabilityInput {
  isDev: boolean;
  isTauriDesktop: boolean;
  replayExportAvailable: boolean;
}

export interface BuildSessionDebugLocatorFromActionStateInput {
  state: SessionDebugActionState;
  generatedAt: Date;
  runtime: {
    location: SessionDebugRuntimeLocation;
    url: string;
    health: HealthResponse;
    anyharnessWorkspaceId: string;
  };
  session: SessionDebugLocatorSession | null;
  owningSlotWorkspaceId: string | null;
}

export function planSessionDebugActionAvailability(
  state: SessionDebugActionState,
  input: PlanSessionDebugActionAvailabilityInput,
): SessionDebugActionAvailability {
  const activeSessionWorkspaceId = resolveActiveSessionWorkspaceId(state);

  return {
    activeSessionWorkspaceId,
    canCopyInvestigationJson: Boolean(state.selectedWorkspaceId ?? activeSessionWorkspaceId),
    canExportActiveSessionJson: input.isTauriDesktop
      && Boolean(state.activeSessionId && activeSessionWorkspaceId),
    canExportReplayRecording: input.isDev
      && input.replayExportAvailable
      && Boolean(state.activeSessionId && activeSessionWorkspaceId),
    canExportWorkspaceJson: input.isTauriDesktop && Boolean(state.selectedWorkspaceId),
  };
}

export function resolveWorkspaceIdForInvestigation(
  state: SessionDebugActionState,
): string | null {
  return resolveActiveSessionWorkspaceId(state) ?? state.selectedWorkspaceId;
}

export function resolveActiveSessionWorkspaceId(
  state: SessionDebugActionState,
): string | null {
  const sessionId = state.activeSessionId;
  if (!sessionId) {
    return null;
  }

  return state.sessionRecords[sessionId]?.workspaceId ?? state.selectedWorkspaceId;
}

export function resolveActiveSessionRecord(
  state: SessionDebugActionState,
): SessionDebugActionSessionRecord | null {
  return state.activeSessionId ? state.sessionRecords[state.activeSessionId] ?? null : null;
}

export function resolveMaterializedSessionIdForDebug(
  state: SessionDebugActionState,
  sessionId: string,
): string | null {
  return state.sessionRecords[sessionId]?.materializedSessionId ?? null;
}

export function requireMaterializedSessionIdForDebug(
  state: SessionDebugActionState,
  sessionId: string,
): string {
  const materializedSessionId = resolveMaterializedSessionIdForDebug(state, sessionId);
  if (!materializedSessionId) {
    throw new Error("Session is still starting. Try again in a moment.");
  }
  return materializedSessionId;
}

export function fallbackLocatorSession(
  state: SessionDebugActionState,
  sessionId: string,
): SessionDebugLocatorSession {
  const slot = state.sessionRecords[sessionId] ?? null;
  return {
    id: sessionId,
    owningWorkspaceId: slot?.workspaceId ?? null,
    agentKind: slot?.agentKind ?? null,
    status: slot?.status ?? null,
    title: slot?.title ?? null,
    modelId: slot?.modelId ?? null,
    modeId: slot?.modeId ?? null,
    nativeSessionId: null,
    actionCapabilities: slot?.actionCapabilities ?? null,
    createdAt: null,
    updatedAt: null,
  };
}

export function resolveRuntimeLocation(
  localRuntimeUrl: string,
  resolvedRuntimeUrl: string,
): SessionDebugRuntimeLocation {
  return normalizeRuntimeUrl(localRuntimeUrl) === normalizeRuntimeUrl(resolvedRuntimeUrl)
    ? "local"
    : "cloud";
}

export function buildSessionDebugLocatorFromActionState({
  state,
  generatedAt,
  runtime,
  session,
  owningSlotWorkspaceId,
}: BuildSessionDebugLocatorFromActionStateInput): SessionDebugLocator {
  return buildSessionDebugLocator({
    generatedAt,
    runtime: {
      location: runtime.location,
      url: runtime.url,
      health: runtime.health,
    },
    workspace: {
      uiWorkspaceId: state.selectedWorkspaceId,
      logicalWorkspaceId: state.selectedLogicalWorkspaceId,
      anyharnessWorkspaceId: runtime.anyharnessWorkspaceId,
      owningSlotWorkspaceId,
    },
    session,
  });
}

export function formatSessionDebugErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Debug export failed.";
}

function normalizeRuntimeUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}
