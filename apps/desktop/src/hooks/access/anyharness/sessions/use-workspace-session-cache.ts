import type { Session } from "@anyharness/sdk";
import {
  anyHarnessSessionKey,
  anyHarnessSessionsKey,
  useAnyHarnessCacheScopeKey,
} from "@anyharness/sdk-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

export type WorkspaceSession = Session & { workspaceId: string };

export interface WorkspaceSessionCacheSnapshot {
  sessions: WorkspaceSession[] | undefined;
  dataUpdatedAt: number;
  isInvalidated: boolean;
}

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
  const cacheScopeKey = useAnyHarnessCacheScopeKey();

  const getWorkspaceSessionCacheSnapshot = useCallback((
    workspaceId: string,
  ): WorkspaceSessionCacheSnapshot => {
    const queryKey = anyHarnessSessionsKey(cacheScopeKey, workspaceId);
    const queryState = queryClient.getQueryState(queryKey);
    return {
      sessions: queryClient.getQueryData<WorkspaceSession[]>(queryKey),
      dataUpdatedAt: queryState?.dataUpdatedAt ?? 0,
      isInvalidated: queryState?.isInvalidated ?? false,
    };
  }, [cacheScopeKey, queryClient]);

  const setWorkspaceSessions = useCallback((
    workspaceId: string,
    updater: (sessions: WorkspaceSession[] | undefined) => WorkspaceSession[],
  ) => {
    queryClient.setQueryData<WorkspaceSession[]>(
      anyHarnessSessionsKey(cacheScopeKey, workspaceId),
      updater,
    );
  }, [cacheScopeKey, queryClient]);

  const upsertWorkspaceSessionRecord = useCallback((
    workspaceId: string,
    session: Session,
  ) => {
    queryClient.setQueryData(
      anyHarnessSessionKey(cacheScopeKey, workspaceId, session.id),
      session,
    );
    queryClient.setQueryData<WorkspaceSession[]>(
      anyHarnessSessionsKey(cacheScopeKey, workspaceId),
      (sessions) => upsertWorkspaceSession(sessions, {
        ...session,
        workspaceId,
      }),
    );
  }, [cacheScopeKey, queryClient]);

  const removeWorkspaceSessionRecord = useCallback((
    workspaceId: string,
    sessionId: string,
  ) => {
    queryClient.setQueryData<WorkspaceSession[]>(
      anyHarnessSessionsKey(cacheScopeKey, workspaceId),
      (sessions) => removeWorkspaceSession(sessions, sessionId),
    );
  }, [cacheScopeKey, queryClient]);

  return {
    getWorkspaceSessionCacheSnapshot,
    setWorkspaceSessions,
    upsertWorkspaceSessionRecord,
    removeWorkspaceSessionRecord,
  };
}
