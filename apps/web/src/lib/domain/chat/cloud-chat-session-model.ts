import type {
  CloudSessionProjection,
  CloudWorkspaceSnapshot,
} from "@proliferate/cloud-sdk";
import type {
  CloudLaunchComposerSelection,
  LaunchSessionConfigUpdate,
} from "@proliferate/product-domain/chats/cloud/composer-controls";

export interface CloudPendingPromptRecoveryCandidate {
  agentKind?: string | null;
  createdAt: number;
}

export interface CloudSessionDraftSelectionSnapshot {
  selection: CloudLaunchComposerSelection;
  sessionConfigUpdates: readonly LaunchSessionConfigUpdate[];
}

export function compareSessions(left: CloudSessionProjection, right: CloudSessionProjection): number {
  return sessionRecencyMs(right) - sessionRecencyMs(left)
    || (right.lastEventSeq ?? 0) - (left.lastEventSeq ?? 0);
}

export function findRecoverableSessionForPendingPrompt(
  sessions: readonly CloudSessionProjection[],
  prompt: CloudPendingPromptRecoveryCandidate,
): CloudSessionProjection | null {
  if (Date.now() - prompt.createdAt > 30 * 60 * 1000) {
    return null;
  }
  const earliestStartMs = prompt.createdAt - 30_000;
  return sessions
    .filter((session) =>
      sessionStartedMs(session) >= earliestStartMs
      && (
        !prompt.agentKind
        || !session.sourceAgentKind
        || session.sourceAgentKind === prompt.agentKind
      )
    )
    .sort(compareSessions)[0] ?? null;
}

export function sessionDraftMatchesSelection(
  draft: CloudSessionDraftSelectionSnapshot,
  selection: CloudLaunchComposerSelection,
  sessionConfigUpdates: readonly LaunchSessionConfigUpdate[],
): boolean {
  return launchSelectionsEqual(draft.selection, selection)
    && JSON.stringify(draft.sessionConfigUpdates) === JSON.stringify(sessionConfigUpdates);
}

export function sessionOptionLabel(session: Pick<CloudSessionProjection, "sessionId" | "title">): string {
  return cleanSessionTitle(session.title) ?? `Session ${session.sessionId.slice(0, 8)}`;
}

export function relativeSessionTime(value: string | null): string | null {
  const timestamp = value ? Date.parse(value) : 0;
  if (!timestamp) {
    return null;
  }
  const elapsedMs = Math.max(0, Date.now() - timestamp);
  if (elapsedMs < 60_000) {
    return "now";
  }
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }
  return `${Math.floor(hours / 24)}d`;
}

export function shouldSuppressWorkspaceSessionRedirect(state: unknown): boolean {
  return Boolean(
    state
      && typeof state === "object"
      && "startNewSession" in state
      && (state as { startNewSession?: unknown }).startNewSession === true,
  );
}

export function effectiveWorkspaceStatus(
  workspace: { status?: string | null; workspaceStatus?: string | null },
): string | null {
  return workspace.workspaceStatus ?? workspace.status ?? null;
}

export function mergeWorkspaceSnapshot(
  querySnapshot: CloudWorkspaceSnapshot | undefined,
  liveSnapshot: CloudWorkspaceSnapshot | undefined,
): CloudWorkspaceSnapshot | undefined {
  if (!querySnapshot) {
    return liveSnapshot;
  }
  if (!liveSnapshot) {
    return querySnapshot;
  }
  return {
    ...liveSnapshot,
    workspace: querySnapshot.workspace,
    sessions: mergeSessionProjections(querySnapshot.sessions, liveSnapshot.sessions),
  };
}

function sessionRecencyMs(
  session: Pick<CloudSessionProjection, "lastEventAt" | "startedAt">,
): number {
  return Date.parse(session.lastEventAt ?? session.startedAt ?? "") || 0;
}

function sessionStartedMs(
  session: Pick<CloudSessionProjection, "lastEventAt" | "startedAt">,
): number {
  return Date.parse(session.startedAt ?? "") || Date.parse(session.lastEventAt ?? "") || 0;
}

function launchSelectionsEqual(
  left: CloudLaunchComposerSelection,
  right: CloudLaunchComposerSelection,
): boolean {
  return left.agentKind === right.agentKind
    && left.modelId === right.modelId
    && left.modeId === right.modeId
    && JSON.stringify(left.controlValues) === JSON.stringify(right.controlValues);
}

function cleanSessionTitle(title: string | null | undefined): string | null {
  const value = title?.trim();
  if (!value) {
    return null;
  }
  const normalized = value.toLowerCase();
  if (
    normalized === "invalid input"
    || normalized === "unclear input"
    || normalized === "stray keystroke"
    || normalized === "single character input"
  ) {
    return null;
  }
  return value;
}

function mergeSessionProjections(
  querySessions: readonly CloudSessionProjection[],
  liveSessions: readonly CloudSessionProjection[],
): CloudSessionProjection[] {
  const merged = new Map<string, CloudSessionProjection>();
  for (const session of querySessions) {
    merged.set(session.sessionId, session);
  }
  for (const session of liveSessions) {
    merged.set(session.sessionId, session);
  }
  return [...merged.values()];
}
