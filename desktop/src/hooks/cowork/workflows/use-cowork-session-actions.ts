import {
  useDismissSessionMutation,
  useUpdateSessionTitleMutation,
} from "@anyharness/sdk-react";
import { useCallback } from "react";
import { useCoworkCache } from "@/hooks/access/anyharness/cowork/use-cowork-cache";
import { useDismissedSessionCleanup } from "@/hooks/sessions/workflows/use-dismissed-session-cleanup";
import { useSessionSummaryActions } from "@/hooks/sessions/workflows/use-session-summary-actions";
import { useWorkspaceSessionCache } from "@/hooks/access/anyharness/sessions/use-workspace-session-cache";

export function useCoworkSessionActions() {
  const { applySessionSummary } = useSessionSummaryActions();
  const { upsertWorkspaceSessionRecord } = useWorkspaceSessionCache();
  const {
    invalidateCoworkManagedWorkspaces,
    invalidateCoworkStatus,
    invalidateCoworkThreads,
  } = useCoworkCache();
  const cleanupDismissedSession = useDismissedSessionCleanup();
  const dismissSessionMutation = useDismissSessionMutation();
  const updateSessionTitleMutation = useUpdateSessionTitleMutation();

  const renameThread = useCallback(async (
    sessionId: string,
    workspaceId: string,
    title: string,
  ) => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      throw new Error("Chat title cannot be empty.");
    }
    const session = await updateSessionTitleMutation.mutateAsync({
      workspaceId,
      sessionId,
      request: { title: trimmedTitle },
    });
    applySessionSummary(sessionId, session, workspaceId);
    upsertWorkspaceSessionRecord(workspaceId, session);
    await invalidateCoworkThreads();
    return session;
  }, [applySessionSummary, invalidateCoworkThreads, updateSessionTitleMutation, upsertWorkspaceSessionRecord]);

  const archiveThread = useCallback(async (sessionId: string, workspaceId: string) => {
    await dismissSessionMutation.mutateAsync({ workspaceId, sessionId });
    cleanupDismissedSession(sessionId, workspaceId);
    await Promise.all([
      invalidateCoworkThreads(),
      invalidateCoworkStatus(),
    ]);
  }, [cleanupDismissedSession, dismissSessionMutation, invalidateCoworkStatus, invalidateCoworkThreads]);

  const renameCodingSession = useCallback(async (input: {
    sessionId: string;
    workspaceId: string;
    title: string;
    parentSessionId: string;
  }) => {
    const trimmedTitle = input.title.trim();
    if (!trimmedTitle) {
      throw new Error("Chat title cannot be empty.");
    }
    const session = await updateSessionTitleMutation.mutateAsync({
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      request: { title: trimmedTitle },
    });
    applySessionSummary(input.sessionId, session, input.workspaceId);
    upsertWorkspaceSessionRecord(input.workspaceId, session);
    await invalidateCoworkManagedWorkspaces(input.parentSessionId);
    return session;
  }, [
    applySessionSummary,
    invalidateCoworkManagedWorkspaces,
    updateSessionTitleMutation,
    upsertWorkspaceSessionRecord,
  ]);

  const archiveCodingSession = useCallback(async (input: {
    sessionId: string;
    workspaceId: string;
    parentSessionId: string;
  }) => {
    await dismissSessionMutation.mutateAsync({
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
    });
    cleanupDismissedSession(input.sessionId, input.workspaceId);
    await invalidateCoworkManagedWorkspaces(input.parentSessionId);
  }, [cleanupDismissedSession, dismissSessionMutation, invalidateCoworkManagedWorkspaces]);

  return { renameThread, archiveThread, renameCodingSession, archiveCodingSession };
}
