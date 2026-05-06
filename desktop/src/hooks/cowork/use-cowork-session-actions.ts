import {
  anyHarnessCoworkManagedWorkspacesKey,
  anyHarnessCoworkStatusKey,
  anyHarnessCoworkThreadsKey,
  getAnyHarnessClient,
} from "@anyharness/sdk-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { getWorkspaceClientAndId } from "@/lib/integrations/anyharness/session-runtime";
import { useDismissedSessionCleanup } from "@/hooks/sessions/use-dismissed-session-cleanup";
import { useSessionRuntimeActions } from "@/hooks/sessions/use-session-runtime-actions";
import { useWorkspaceSessionCache } from "@/hooks/sessions/use-workspace-session-cache";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";

export function useCoworkSessionActions() {
  const runtimeUrl = useHarnessConnectionStore((s) => s.runtimeUrl);
  const queryClient = useQueryClient();
  const { applySessionSummary } = useSessionRuntimeActions();
  const { upsertWorkspaceSessionRecord } = useWorkspaceSessionCache();
  const cleanupDismissedSession = useDismissedSessionCleanup();

  const renameThread = useCallback(async (
    sessionId: string,
    workspaceId: string,
    title: string,
  ) => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      throw new Error("Chat title cannot be empty.");
    }
    const { connection } = await getWorkspaceClientAndId(runtimeUrl, workspaceId);
    const session = await getAnyHarnessClient(connection).sessions.updateTitle(sessionId, { title: trimmedTitle });
    applySessionSummary(sessionId, session, workspaceId);
    upsertWorkspaceSessionRecord(workspaceId, session);
    await queryClient.invalidateQueries({ queryKey: anyHarnessCoworkThreadsKey(runtimeUrl) });
    return session;
  }, [applySessionSummary, queryClient, runtimeUrl, upsertWorkspaceSessionRecord]);

  const archiveThread = useCallback(async (sessionId: string, workspaceId: string) => {
    const { connection } = await getWorkspaceClientAndId(runtimeUrl, workspaceId);
    await getAnyHarnessClient(connection).sessions.dismiss(sessionId);
    cleanupDismissedSession(sessionId, workspaceId);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: anyHarnessCoworkThreadsKey(runtimeUrl) }),
      queryClient.invalidateQueries({ queryKey: anyHarnessCoworkStatusKey(runtimeUrl) }),
    ]);
  }, [cleanupDismissedSession, queryClient, runtimeUrl]);

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
    const { connection } = await getWorkspaceClientAndId(runtimeUrl, input.workspaceId);
    const session = await getAnyHarnessClient(connection).sessions.updateTitle(input.sessionId, { title: trimmedTitle });
    applySessionSummary(input.sessionId, session, input.workspaceId);
    upsertWorkspaceSessionRecord(input.workspaceId, session);
    await queryClient.invalidateQueries({
      queryKey: anyHarnessCoworkManagedWorkspacesKey(runtimeUrl, input.parentSessionId),
    });
    return session;
  }, [applySessionSummary, queryClient, runtimeUrl, upsertWorkspaceSessionRecord]);

  const archiveCodingSession = useCallback(async (input: {
    sessionId: string;
    workspaceId: string;
    parentSessionId: string;
  }) => {
    const { connection } = await getWorkspaceClientAndId(runtimeUrl, input.workspaceId);
    await getAnyHarnessClient(connection).sessions.dismiss(input.sessionId);
    cleanupDismissedSession(input.sessionId, input.workspaceId);
    await queryClient.invalidateQueries({
      queryKey: anyHarnessCoworkManagedWorkspacesKey(runtimeUrl, input.parentSessionId),
    });
  }, [cleanupDismissedSession, queryClient, runtimeUrl]);

  return { renameThread, archiveThread, renameCodingSession, archiveCodingSession };
}
