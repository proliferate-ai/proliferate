import { getAnyHarnessClient } from "@anyharness/sdk-react";
import type { ReplayRecordingSummary } from "@anyharness/sdk";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { resolveSessionViewState } from "@/lib/domain/sessions/activity";
import { DESKTOP_ORIGIN } from "@/lib/integrations/anyharness/origin";
import { closeSessionStreamHandle } from "@/lib/integrations/anyharness/session-stream-handles";
import { useSessionRuntimeActions } from "@/hooks/sessions/use-session-runtime-actions";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import {
  combineSessionRecord,
  createEmptySessionRecord,
  putSessionRecord,
  removeSessionRecord,
} from "@/stores/sessions/session-records";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useSessionTranscriptStore } from "@/stores/sessions/session-transcript-store";

const PLAYGROUND_REPLAY_WORKSPACE_PATH =
  import.meta.env.VITE_PLAYGROUND_REPLAY_WORKSPACE_PATH ?? ".";

export interface PlaygroundReplayState {
  enabled: boolean;
  recordings: ReplayRecordingSummary[];
  sessionId: string | null;
  workspaceId: string | null;
  isLoadingRecordings: boolean;
  isCreatingSession: boolean;
  isAdvancing: boolean;
  error: string | null;
  hasPendingInteraction: boolean;
  isBusy: boolean;
  canAdvance: boolean;
  advance: () => Promise<void>;
}

export function useReplaySession(recordingId: string | null): PlaygroundReplayState {
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const client = useMemo(() => getAnyHarnessClient({ runtimeUrl }), [runtimeUrl]);
  const { ensureSessionStreamConnected } = useSessionRuntimeActions();
  const ensureSessionStreamConnectedRef = useRef(ensureSessionStreamConnected);
  const [enabled, setEnabled] = useState(false);
  const [recordings, setRecordings] = useState<ReplayRecordingSummary[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [isLoadingRecordings, setIsLoadingRecordings] = useState(false);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [isAdvancing, setIsAdvancing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const directory = useSessionDirectoryStore((state) =>
    sessionId ? state.entriesById[sessionId] ?? null : null
  );
  const transcriptEntry = useSessionTranscriptStore((state) =>
    sessionId ? state.entriesById[sessionId] ?? null : null
  );
  const slot = useMemo(
    () => combineSessionRecord(directory, transcriptEntry),
    [directory, transcriptEntry],
  );

  useEffect(() => {
    ensureSessionStreamConnectedRef.current = ensureSessionStreamConnected;
  }, [ensureSessionStreamConnected]);

  useEffect(() => {
    let cancelled = false;
    setIsLoadingRecordings(true);
    setError(null);

    async function loadRecordings() {
      try {
        const health = await client.runtime.getHealth();
        const replayEnabled = health.capabilities?.replay === true;
        if (cancelled) {
          return;
        }
        setEnabled(replayEnabled);
        if (!replayEnabled) {
          setRecordings([]);
          return;
        }
        const response = await client.replay.listRecordings();
        if (!cancelled) {
          setRecordings(response.recordings);
        }
      } catch (loadError) {
        if (!cancelled) {
          setEnabled(false);
          setRecordings([]);
          setError(errorMessage(loadError));
        }
      } finally {
        if (!cancelled) {
          setIsLoadingRecordings(false);
        }
      }
    }

    void loadRecordings();

    return () => {
      cancelled = true;
    };
  }, [client]);

  useEffect(() => {
    if (!enabled || !recordingId) {
      setSessionId(null);
      setWorkspaceId(null);
      setIsCreatingSession(false);
      return;
    }

    const activeRecordingId = recordingId;
    let cancelled = false;
    let createdSessionId: string | null = null;
    setIsCreatingSession(true);
    setError(null);

    async function createReplaySession() {
      try {
        const resolvedWorkspaceId = await resolveReplayWorkspaceId(
          client,
          useSessionSelectionStore.getState().selectedWorkspaceId,
        );
        if (cancelled) {
          return;
        }
        const response = await client.replay.createSession({
          workspaceId: resolvedWorkspaceId,
          recordingId: activeRecordingId,
        });
        const session = response.session;
        createdSessionId = session.id;
        if (cancelled) {
          cleanupReplaySession(client, session.id);
          return;
        }
        putSessionRecord({
          ...createEmptySessionRecord(session.id, session.agentKind, {
            workspaceId: session.workspaceId,
            modelId: session.modelId ?? null,
            modeId: session.modeId ?? null,
            title: session.title ?? null,
            liveConfig: session.liveConfig ?? null,
            executionSummary: session.executionSummary ?? null,
            lastPromptAt: session.lastPromptAt ?? null,
          }),
          status: session.status,
        });
        useSessionSelectionStore.getState().activateWorkspace({
          logicalWorkspaceId: null,
          workspaceId: session.workspaceId,
          initialActiveSessionId: session.id,
          clearPending: false,
        });
        setWorkspaceId(session.workspaceId);
        setSessionId(session.id);
        await ensureSessionStreamConnectedRef.current(session.id, {
          awaitOpen: true,
          openTimeoutMs: 2500,
          resumeIfActive: false,
        });
      } catch (createError) {
        if (!cancelled) {
          setSessionId(null);
          setWorkspaceId(null);
          setError(errorMessage(createError));
        }
      } finally {
        if (!cancelled) {
          setIsCreatingSession(false);
        }
      }
    }

    void createReplaySession();

    return () => {
      cancelled = true;
      if (createdSessionId) {
        cleanupReplaySession(client, createdSessionId);
      }
    };
  }, [
    client,
    enabled,
    recordingId,
  ]);

  const sessionViewState = resolveSessionViewState(slot);
  const hasPendingInteraction = Boolean(
    slot
      && (
        slot.transcript.pendingInteractions.length > 0
        || (slot.executionSummary?.pendingInteractions?.length ?? 0) > 0
      ),
  );
  const isBusy = sessionViewState === "working" || sessionViewState === "needs_input";
  const canAdvance = Boolean(
    sessionId
      && slot
      && slot.streamConnectionState === "open"
      && sessionViewState === "idle"
      && !hasPendingInteraction
      && slot.status !== "closed"
      && slot.status !== "errored"
      && !isCreatingSession
      && !isAdvancing,
  );

  const advance = useCallback(async () => {
    if (!sessionId || !canAdvance) {
      return;
    }
    setIsAdvancing(true);
    setError(null);
    try {
      await client.replay.advanceSession(sessionId);
    } catch (advanceError) {
      setError(errorMessage(advanceError));
    } finally {
      setIsAdvancing(false);
    }
  }, [canAdvance, client, sessionId]);

  return {
    enabled,
    recordings,
    sessionId,
    workspaceId,
    isLoadingRecordings,
    isCreatingSession,
    isAdvancing,
    error,
    hasPendingInteraction,
    isBusy,
    canAdvance,
    advance,
  };
}

async function resolveReplayWorkspaceId(
  client: ReturnType<typeof getAnyHarnessClient>,
  selectedWorkspaceId: string | null,
): Promise<string> {
  if (selectedWorkspaceId) {
    try {
      await client.workspaces.get(selectedWorkspaceId);
      return selectedWorkspaceId;
    } catch {
      // Fall back to the dev replay workspace below.
    }
  }

  const response = await client.workspaces.resolveFromPath({
    path: PLAYGROUND_REPLAY_WORKSPACE_PATH,
    origin: DESKTOP_ORIGIN,
  });
  return response.workspace.id;
}

function cleanupReplaySession(
  client: ReturnType<typeof getAnyHarnessClient>,
  sessionId: string,
): void {
  closeSessionStreamHandle(sessionId);
  removeSessionRecord(sessionId);
  const state = useSessionSelectionStore.getState();
  if (state.activeSessionId === sessionId) {
    state.setActiveSessionId(null);
  }
  void client.sessions.close(sessionId).catch(() => {});
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Replay request failed.";
}
