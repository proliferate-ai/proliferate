import {
  anyHarnessSessionKey,
  anyHarnessSessionsKey,
} from "@anyharness/sdk-react";
import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Session } from "@anyharness/sdk";
import { useHarnessStore } from "@/stores/sessions/harness-store";

export type WorkspaceSession = Session & { workspaceId: string };

function upsertWorkspaceSession(
  sessions: WorkspaceSession[] | undefined,
  updatedSession: WorkspaceSession,
): WorkspaceSession[] {
  const nextSessions = (sessions ?? []).filter((session) => session.id !== updatedSession.id);
  nextSessions.unshift(updatedSession);
  return nextSessions;
}

function removeWorkspaceSession(
  sessions: WorkspaceSession[] | undefined,
  sessionId: string,
): WorkspaceSession[] {
  return (sessions ?? []).filter((session) => session.id !== sessionId);
}

export function useWorkspaceSessionCache() {
  const queryClient = useQueryClient();
  const runtimeUrl = useHarnessStore((state) => state.runtimeUrl);

  const setWorkspaceSessions = useCallback((
    workspaceId: string,
    updater: (sessions: WorkspaceSession[] | undefined) => WorkspaceSession[],
  ) => {
    queryClient.setQueryData<WorkspaceSession[]>(
      anyHarnessSessionsKey(runtimeUrl, workspaceId),
      updater,
    );
  }, [queryClient, runtimeUrl]);

  const upsertWorkspaceSessionRecord = useCallback((
    workspaceId: string,
    session: Session,
  ) => {
    queryClient.setQueryData(
      anyHarnessSessionKey(runtimeUrl, workspaceId, session.id),
      session,
    );
    queryClient.setQueryData<WorkspaceSession[]>(
      anyHarnessSessionsKey(runtimeUrl, workspaceId),
      (sessions) => upsertWorkspaceSession(sessions, {
        ...session,
        workspaceId,
      }),
    );
  }, [queryClient, runtimeUrl]);

  const removeWorkspaceSessionRecord = useCallback((
    workspaceId: string,
    sessionId: string,
  ) => {
    queryClient.setQueryData<WorkspaceSession[]>(
      anyHarnessSessionsKey(runtimeUrl, workspaceId),
      (sessions) => removeWorkspaceSession(sessions, sessionId),
    );
  }, [queryClient, runtimeUrl]);

  return {
    setWorkspaceSessions,
    upsertWorkspaceSessionRecord,
    removeWorkspaceSessionRecord,
  };
}
