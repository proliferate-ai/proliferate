import {
  reduceEvents,
  streamSession,
  type SessionEventEnvelope,
  type TranscriptState,
} from "@anyharness/sdk";
import {
  useAnyHarnessWorkspaceContext,
  useSessionEventsQuery,
} from "@anyharness/sdk-react";
import type { StreamConnectionState } from "@proliferate/product-domain/sessions/activity";
import { useEffect, useMemo, useState } from "react";

const EMPTY_EVENTS: readonly SessionEventEnvelope[] = [];

export function useWebAnyHarnessSessionTranscript(input: {
  workspaceId: string | null;
  sessionId: string | null;
  enabled?: boolean;
}): {
  transcript: TranscriptState | null;
  events: readonly SessionEventEnvelope[];
  isLoading: boolean;
  error: Error | null;
  streamConnectionState: StreamConnectionState;
  refetch: () => Promise<unknown>;
} {
  const workspace = useAnyHarnessWorkspaceContext();
  const enabled = (input.enabled ?? true) && Boolean(input.workspaceId && input.sessionId);
  const eventsQuery = useSessionEventsQuery(input.sessionId, {
    workspaceId: input.workspaceId,
    enabled,
    request: {
      oldestFirst: true,
      turnLimit: 80,
    },
  });
  const baseEvents = eventsQuery.data ?? EMPTY_EVENTS;
  const baseLastSeq = useMemo(
    () => baseEvents.reduce((max, event) => Math.max(max, event.seq), 0),
    [baseEvents],
  );
  const [streamEvents, setStreamEvents] = useState<SessionEventEnvelope[]>([]);
  const [streamConnectionState, setStreamConnectionState] =
    useState<StreamConnectionState>("disconnected");
  const [streamError, setStreamError] = useState<Error | null>(null);

  useEffect(() => {
    setStreamEvents([]);
    setStreamConnectionState(enabled ? "connecting" : "disconnected");
    setStreamError(null);
  }, [enabled, input.sessionId, input.workspaceId]);

  useEffect(() => {
    if (!enabled || !input.workspaceId || !input.sessionId || !eventsQuery.isFetched) {
      return;
    }

    let disposed = false;
    let handle: ReturnType<typeof streamSession> | null = null;
    setStreamConnectionState("connecting");
    setStreamError(null);

    void (async () => {
      try {
        const connection = await workspace.resolveConnection(input.workspaceId!);
        if (disposed) {
          return;
        }
        handle = streamSession({
          baseUrl: connection.runtimeUrl,
          authToken: connection.authToken,
          sessionId: input.sessionId!,
          afterSeq: baseLastSeq > 0 ? baseLastSeq : undefined,
          onOpen: () => {
            if (!disposed) {
              setStreamConnectionState("open");
            }
          },
          onEvent: (event) => {
            if (disposed || event.seq <= baseLastSeq) {
              return;
            }
            setStreamEvents((current) => {
              if (current.some((candidate) => candidate.seq === event.seq)) {
                return current;
              }
              return [...current, event].sort((left, right) => left.seq - right.seq);
            });
          },
          onClose: () => {
            if (!disposed) {
              setStreamConnectionState("ended");
            }
          },
          onError: (error) => {
            if (disposed) {
              return;
            }
            setStreamError(error);
            setStreamConnectionState("disconnected");
            void eventsQuery.refetch();
          },
        });
      } catch (error) {
        if (!disposed) {
          setStreamError(error instanceof Error ? error : new Error("Session stream failed"));
          setStreamConnectionState("disconnected");
        }
      }
    })();

    return () => {
      disposed = true;
      handle?.close();
    };
  }, [
    baseLastSeq,
    enabled,
    eventsQuery.isFetched,
    input.sessionId,
    input.workspaceId,
    workspace,
  ]);

  const events = useMemo(() => {
    if (!input.sessionId) {
      return EMPTY_EVENTS;
    }
    const bySeq = new Map<number, SessionEventEnvelope>();
    for (const event of baseEvents) {
      bySeq.set(event.seq, event);
    }
    for (const event of streamEvents) {
      bySeq.set(event.seq, event);
    }
    return [...bySeq.values()].sort((left, right) => left.seq - right.seq);
  }, [baseEvents, input.sessionId, streamEvents]);

  const transcript = useMemo(
    () => input.sessionId ? reduceEvents([...events], input.sessionId) : null,
    [events, input.sessionId],
  );

  return {
    transcript,
    events,
    isLoading: eventsQuery.isLoading && !transcript,
    error: eventsQuery.error instanceof Error ? eventsQuery.error : streamError,
    streamConnectionState,
    refetch: eventsQuery.refetch,
  };
}
