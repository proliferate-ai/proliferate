import {
  anyHarnessCoworkManagedWorkspacesKey,
  anyHarnessCoworkStatusKey,
  anyHarnessCoworkThreadsKey,
  useDismissSessionMutation,
  useUpdateSessionTitleMutation,
} from "@anyharness/sdk-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
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
    await queryClient.invalidateQueries({ queryKey: anyHarnessCoworkThreadsKey(runtimeUrl) });
    return session;
  }, [applySessionSummary, queryClient, runtimeUrl, updateSessionTitleMutation, upsertWorkspaceSessionRecord]);

  const archiveThread = useCallback(async (sessionId: string, workspaceId: string) => {
    await dismissSessionMutation.mutateAsync({ workspaceId, sessionId });
    cleanupDismissedSession(sessionId, workspaceId);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: anyHarnessCoworkThreadsKey(runtimeUrl) }),
      queryClient.invalidateQueries({ queryKey: anyHarnessCoworkStatusKey(runtimeUrl) }),
    ]);
  }, [cleanupDismissedSession, dismissSessionMutation, queryClient, runtimeUrl]);

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
    await queryClient.invalidateQueries({
      queryKey: anyHarnessCoworkManagedWorkspacesKey(runtimeUrl, input.parentSessionId),
    });
    return session;
  }, [applySessionSummary, queryClient, runtimeUrl, updateSessionTitleMutation, upsertWorkspaceSessionRecord]);

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
    await queryClient.invalidateQueries({
      queryKey: anyHarnessCoworkManagedWorkspacesKey(runtimeUrl, input.parentSessionId),
    });
  }, [cleanupDismissedSession, dismissSessionMutation, queryClient, runtimeUrl]);

  return { renameThread, archiveThread, renameCodingSession, archiveCodingSession };
}
