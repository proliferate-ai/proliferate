export interface WorkspaceSelectionSessionLike {
  id: string;
  lastPromptAt?: string | null;
  updatedAt?: string | null;
}

export function hasHiddenDismissedWorkspaceSessions<T>(
  visibleSessions: readonly T[],
  sessionsIncludingDismissed: readonly T[],
): boolean {
  return sessionsIncludingDismissed.length > visibleSessions.length;
}

function sessionTimestamp(session: WorkspaceSelectionSessionLike): number {
  const timestamp = session.lastPromptAt ?? session.updatedAt;
  return timestamp ? new Date(timestamp).getTime() : 0;
}

export function choosePreferredWorkspaceSession<T extends WorkspaceSelectionSessionLike>(
  sessions: readonly T[],
  lastViewedSessionId: string | null | undefined,
): T | null {
  if (sessions.length === 0) {
    return null;
  }

  const preferredSession = lastViewedSessionId
    ? sessions.find((session) => session.id === lastViewedSessionId) ?? null
    : null;
  if (preferredSession) {
    return preferredSession;
  }

  // Prefer prompted sessions, but never strand the user on the empty hero: when a
  // workspace has only never-prompted sessions (e.g. setup-only sessions), fall back
  // to the most recently updated one so a workspace switch always lands on a session.
  // This mirrors resolveOptimisticWorkspaceSessionId's visible-session fallback so the
  // optimistic and post-load picks agree.
  const promptedSessions = sessions.filter((session) => session.lastPromptAt);
  const rankedSessions = promptedSessions.length > 0 ? promptedSessions : sessions;

  return [...rankedSessions].sort((left, right) => sessionTimestamp(right) - sessionTimestamp(left))[0] ?? null;
}

export function getLatestWorkspaceInteractionTimestamp<T extends WorkspaceSelectionSessionLike>(
  sessions: readonly T[],
): string | null {
  let latestTimestamp: string | null = null;

  for (const session of sessions) {
    const timestamp = session.lastPromptAt ?? session.updatedAt ?? null;
    if (!timestamp) {
      continue;
    }
    if (!latestTimestamp || new Date(timestamp).getTime() > new Date(latestTimestamp).getTime()) {
      latestTimestamp = timestamp;
    }
  }

  return latestTimestamp;
}
