import { useCallback, useEffect, useRef, useState } from "react";
import { activitySnapshotFromDirectoryEntry } from "#product/lib/domain/sessions/directory/directory-activity";
import type { SessionStreamConnectionState } from "#product/lib/domain/sessions/directory/directory-entry";
import { resolveSessionViewState, type SessionViewState } from "#product/domain/sessions/activity";
import { useLinkedSessionMounting } from "#product/hooks/chat/workflows/subagents/use-linked-session-mounting";
import { useSessionRuntimeActions } from "#product/hooks/sessions/workflows/use-session-runtime-actions";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import {
  ensureSessionTranscriptEntry,
  getSessionRecord,
  patchSessionRecord,
} from "#product/stores/sessions/session-records";

export type AgentsPaneHistoryPhase = "loading" | "ready" | "error";

export interface AgentsPaneSessionLifecycleInput {
  workspaceId: string | null;
  parentSessionId: string;
  /** Durable child session ID (roster identity). */
  childSessionId: string;
  /** Mapped ProductClient client session ID the local stores are keyed by. */
  clientSessionId: string;
  sessionLinkId: string | null;
  label: string | null;
  /** Closed children hydrate history but never open a live stream. */
  isClosed: boolean;
  /** Everything here is guarded to the current pane route. */
  isPaneRouteActive: boolean;
}

export interface AgentsPaneSessionLifecycleState {
  historyPhase: AgentsPaneHistoryPhase;
  streamConnectionState: SessionStreamConnectionState | null;
  streamRequestPending: boolean;
  sessionViewState: SessionViewState;
  retryHistory: () => void;
  reconnect: () => void;
}

/**
 * Mount/hydrate/connect lifecycle for the Agents-pane detail transcript. Uses
 * the existing linked-session mounting, explicit history hydration, and
 * arbitrary-session stream connection — no second store, cache, or reducer.
 * It never touches the main activeSessionId: the pane owns only the stream
 * slot it opened, and releases it when the pane leaves the child.
 */
export function useAgentsPaneSessionLifecycle(
  input: AgentsPaneSessionLifecycleInput,
): AgentsPaneSessionLifecycleState {
  const {
    workspaceId,
    parentSessionId,
    childSessionId,
    clientSessionId,
    sessionLinkId,
    label,
    isClosed,
    isPaneRouteActive,
  } = input;
  const { mountSubagentChildSession } = useLinkedSessionMounting();
  const {
    ensureSessionStreamConnected,
    rehydrateSessionSlotFromHistory,
  } = useSessionRuntimeActions();
  const [historyPhase, setHistoryPhase] = useState<AgentsPaneHistoryPhase>("loading");
  const [historyNonce, setHistoryNonce] = useState(0);
  const [streamRequestPending, setStreamRequestPending] = useState(false);

  // The owning hooks currently expose render-unstable callback identities.
  // Keep the latest capabilities behind a ref so a transcript-store rerender
  // cannot tear down and restart the identity-scoped hydrate/connect effect.
  const lifecycleCapabilitiesRef = useRef({
    mountSubagentChildSession,
    ensureSessionStreamConnected,
    rehydrateSessionSlotFromHistory,
  });
  lifecycleCapabilitiesRef.current = {
    mountSubagentChildSession,
    ensureSessionStreamConnected,
    rehydrateSessionSlotFromHistory,
  };

  // Latest guard inputs for isCurrent checks inside long-lived async work.
  const guardRef = useRef({ clientSessionId, isClosed, isPaneRouteActive });
  guardRef.current = { clientSessionId, isClosed, isPaneRouteActive };

  const isCurrent = useCallback((sessionId: string) => (
    guardRef.current.isPaneRouteActive
    && guardRef.current.clientSessionId === sessionId
  ), []);

  const connectPaneStream = useCallback((sessionId: string) => {
    if (guardRef.current.isClosed || !isCurrent(sessionId)) {
      return;
    }
    setStreamRequestPending(true);
    void lifecycleCapabilitiesRef.current.ensureSessionStreamConnected(sessionId, {
      awaitOpen: true,
      isCurrent: () => !guardRef.current.isClosed && isCurrent(sessionId),
    }).finally(() => {
      if (isCurrent(sessionId)) {
        setStreamRequestPending(false);
      }
    });
  }, [isCurrent]);

  useEffect(() => {
    if (!isPaneRouteActive) {
      return;
    }
    guardRef.current = { clientSessionId, isClosed, isPaneRouteActive };
    const sessionId = clientSessionId;
    let cancelled = false;
    setStreamRequestPending(false);
    setHistoryPhase("loading");

    void (async () => {
      if (sessionId !== childSessionId && !getSessionRecord(sessionId)) {
        // A materialized→client mapping is authoritative only when its local
        // ProductClient slot exists. Never send the client key to a durable
        // runtime route if that invariant has been broken.
        setHistoryPhase("error");
        return;
      }
      await lifecycleCapabilitiesRef.current.mountSubagentChildSession({
        childSessionId: sessionId,
        label,
        workspaceId,
        parentSessionId,
        sessionLinkId,
      });
      if (cancelled || !isCurrent(sessionId)) {
        return;
      }
      ensureSessionTranscriptEntry(sessionId);
      const hydrated = await lifecycleCapabilitiesRef.current
        .rehydrateSessionSlotFromHistory(sessionId, {
        replace: true,
        isCurrent: () => !cancelled && isCurrent(sessionId),
      });
      if (cancelled || !isCurrent(sessionId)) {
        return;
      }
      if (hydrated) {
        patchSessionRecord(sessionId, { transcriptHydrated: true });
      }
      setHistoryPhase(hydrated ? "ready" : "error");
      if (hydrated) {
        connectPaneStream(sessionId);
      }
    })();

    return () => {
      cancelled = true;
      if (guardRef.current.clientSessionId === sessionId) {
        guardRef.current = {
          ...guardRef.current,
          isPaneRouteActive: false,
        };
      }
    };
  }, [
    childSessionId,
    clientSessionId,
    connectPaneStream,
    historyNonce,
    isCurrent,
    isPaneRouteActive,
    isClosed,
    label,
    parentSessionId,
    sessionLinkId,
    workspaceId,
  ]);

  const streamConnectionState = useSessionDirectoryStore((state) =>
    state.entriesById[clientSessionId]?.streamConnectionState ?? null,
  );
  const sessionViewState = useSessionDirectoryStore((state) =>
    resolveSessionViewState(
      activitySnapshotFromDirectoryEntry(state.entriesById[clientSessionId]),
    ),
  );

  const retryHistory = useCallback(() => {
    setHistoryNonce((nonce) => nonce + 1);
  }, []);

  const reconnect = useCallback(() => {
    connectPaneStream(guardRef.current.clientSessionId);
  }, [connectPaneStream]);

  return {
    historyPhase,
    streamConnectionState: isClosed ? null : streamConnectionState,
    streamRequestPending: isClosed ? false : streamRequestPending,
    sessionViewState,
    retryHistory,
    reconnect,
  };
}
