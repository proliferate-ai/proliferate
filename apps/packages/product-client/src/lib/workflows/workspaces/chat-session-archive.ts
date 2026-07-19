import type {
  ChatSessionArchiveReservation,
} from "#product/lib/domain/workspaces/tabs/visibility";

export interface VisibleChatSessionDismissOptions {
  replacedActiveSessionIds: readonly string[];
  resolveNextActiveSessionId?: () => string | null;
}

export async function archiveVisibleChatSession(
  sessionId: string,
  deps: {
    completeReservation: (sessionIds: string[]) => void;
    dismissSession: (
      sessionId: string,
      options: VisibleChatSessionDismissOptions,
    ) => Promise<void>;
    getRuntimeBlockReason: () => string | null;
    notifyRuntimeBlocked: (reason: string) => void;
    removeSessionsFromManualGroups: (sessionIds: string[]) => void;
    reserve: (sessionId: string) => ChatSessionArchiveReservation;
    resolveReservedFallback: (capturedFallbackSessionId: string | null) => string | null;
  },
): Promise<boolean> {
  const blockedReason = deps.getRuntimeBlockReason();
  if (blockedReason) {
    deps.notifyRuntimeBlocked(blockedReason);
    return false;
  }

  const reservation = deps.reserve(sessionId);
  if (reservation.kind === "blocked") {
    return false;
  }

  try {
    await deps.dismissSession(sessionId, {
      replacedActiveSessionIds: reservation.sessionIds,
      resolveNextActiveSessionId: reservation.replacesActiveSession
        ? () => deps.resolveReservedFallback(reservation.fallbackSessionId)
        : undefined,
    });
    deps.removeSessionsFromManualGroups(reservation.sessionIds);
    return true;
  } finally {
    deps.completeReservation(reservation.sessionIds);
  }
}
