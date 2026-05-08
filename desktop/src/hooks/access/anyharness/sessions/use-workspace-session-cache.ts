import type { Session } from "@anyharness/sdk";
import {
  anyHarnessSessionKey,
  anyHarnessSessionsKey,
} from "@anyharness/sdk-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";

export type WorkspaceSession = Session & { workspaceId: string };

export interface WorkspaceSessionCacheSnapshot {
  sessions: WorkspaceSession[] | undefined;
  dataUpdatedAt: number;
  isInvalidated: boolean;
}

interface WorkspaceSessionCacheOptions {
  runtimeUrl?: string;
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
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);

  const getWorkspaceSessionCacheSnapshot = useCallback((
    workspaceId: string,
    options?: WorkspaceSessionCacheOptions,
  ): WorkspaceSessionCacheSnapshot => {
    const queryKey = anyHarnessSessionsKey(options?.runtimeUrl ?? runtimeUrl, workspaceId);
    const queryState = queryClient.getQueryState(queryKey);
    return {
      sessions: queryClient.getQueryData<WorkspaceSession[]>(queryKey),
      dataUpdatedAt: queryState?.dataUpdatedAt ?? 0,
      isInvalidated: queryState?.isInvalidated ?? false,
    };
  }, [queryClient, runtimeUrl]);

  const setWorkspaceSessions = useCallback((
    workspaceId: string,
    updater: (sessions: WorkspaceSession[] | undefined) => WorkspaceSession[],
    options?: WorkspaceSessionCacheOptions,
  ) => {
    queryClient.setQueryData<WorkspaceSession[]>(
      anyHarnessSessionsKey(options?.runtimeUrl ?? runtimeUrl, workspaceId),
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
    getWorkspaceSessionCacheSnapshot,
    setWorkspaceSessions,
    upsertWorkspaceSessionRecord,
    removeWorkspaceSessionRecord,
  };
}
