import { useCallback, useEffect, useRef, useState } from "react";
import { activitySnapshotFromDirectoryEntry } from "#product/lib/domain/sessions/directory/directory-activity";
import type { SessionStreamConnectionState } from "#product/lib/domain/sessions/directory/directory-entry";
import { resolveSessionViewState, type SessionViewState } from "#product/domain/sessions/activity";
import {
  advanceReconnectBackoff,
  type ReconnectBackoffState,
} from "#product/lib/domain/sessions/stream/reconnect-backoff-policy";
import { useLinkedSessionMounting } from "#product/hooks/chat/workflows/subagents/use-linked-session-mounting";
import { useSessionRuntimeActions } from "#product/hooks/sessions/workflows/use-session-runtime-actions";
import {
  closeSessionStreamHandle,
  getSessionStreamHandle,
  type ManagedSessionStreamHandle,
} from "#product/lib/access/anyharness/session-stream-handles";
import { isHotSessionClientId } from "#product/lib/workflows/sessions/hot-session-ingest-manager";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import {
  ensureSessionTranscriptEntry,
  getMaterializedSessionId,
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
  /**
   * Shared reconnect-backoff shape (same curve as the primary session
   * stream: base 350ms, factor 2, capped at 15s). Rung 7 wires this through
   * for both consumers to surface consistently; it does not change any
   * existing visual treatment on its own.
   */
  reconnectState: ReconnectBackoffState;
}

interface PaneStreamLease {
  clientSessionId: string;
  materializedSessionId: string;
  handle: ManagedSessionStreamHandle;
}

interface PaneStreamAttempt {
  clientSessionId: string;
  materializedSessionId: string | null;
  baselineHandle: ManagedSessionStreamHandle | null;
  mayOwnOpenedHandle: boolean;
  token: symbol;
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
  const paneStreamLeaseRef = useRef<PaneStreamLease | null>(null);
  const paneStreamAttemptRef = useRef<PaneStreamAttempt | null>(null);
  // Pane-owned retry state for its explicit `onReconnectNeeded` signal. Kept
  // local to this hook instance (never a module-level/shared map) so the
  // pane's retry policy cannot collide with any other owner's reconnect
  // bookkeeping for the same session id.
  const paneReconnectTimerRef = useRef<{
    sessionId: string;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const paneReconnectBackoffRef = useRef<Map<string, ReconnectBackoffState>>(new Map());
  const [reconnectState, setReconnectState] = useState<ReconnectBackoffState>({
    attempt: 0,
    nextDelayMs: 0,
    reconnecting: false,
  });

  const clearPaneReconnectTimer = useCallback((sessionId?: string) => {
    const pending = paneReconnectTimerRef.current;
    if (pending && (!sessionId || pending.sessionId === sessionId)) {
      clearTimeout(pending.timer);
      paneReconnectTimerRef.current = null;
    }
  }, []);

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

  const releasePaneStream = useCallback((sessionId: string) => {
    // A closed or unmounted child must never keep retrying: cancel any
    // pending pane-owned reconnect and drop its backoff count.
    clearPaneReconnectTimer(sessionId);
    paneReconnectBackoffRef.current.delete(sessionId);
    if (isCurrent(sessionId)) {
      setReconnectState({ attempt: 0, nextDelayMs: 0, reconnecting: false });
    }

    const lease = paneStreamLeaseRef.current?.clientSessionId === sessionId
      ? paneStreamLeaseRef.current
      : null;
    const attempt = paneStreamAttemptRef.current?.clientSessionId === sessionId
      ? paneStreamAttemptRef.current
      : null;
    if (lease) {
      paneStreamLeaseRef.current = null;
    }
    if (attempt) {
      paneStreamAttemptRef.current = null;
    }

    // Once hot-session ingestion targets this child, that manager owns the
    // shared slot. Leaving the pane must not tear down its live attachment.
    if (isHotSessionClientId(sessionId)) {
      return;
    }

    const handlesToClose = new Map<string, ManagedSessionStreamHandle>();
    if (lease) {
      handlesToClose.set(lease.materializedSessionId, lease.handle);
    }
    if (attempt?.mayOwnOpenedHandle && attempt.materializedSessionId) {
      const currentHandle = getSessionStreamHandle(attempt.materializedSessionId);
      if (currentHandle && currentHandle !== attempt.baselineHandle) {
        handlesToClose.set(attempt.materializedSessionId, currentHandle);
      }
    }

    let closed = false;
    for (const [materializedSessionId, handle] of handlesToClose) {
      closed = closeSessionStreamHandle(materializedSessionId, handle) || closed;
    }
    if (closed && getSessionRecord(sessionId)) {
      useSessionDirectoryStore.getState().patchEntry(sessionId, {
        streamConnectionState: "disconnected",
      });
    }
  }, [clearPaneReconnectTimer, isCurrent]);

  const connectPaneStream = useCallback((sessionId: string) => {
    if (guardRef.current.isClosed || !isCurrent(sessionId)) {
      return;
    }
    if (paneStreamAttemptRef.current?.clientSessionId === sessionId) {
      return;
    }
    // A fresh/explicit connect (mount, retryHistory, the user's own
    // `reconnect()`) supersedes any reconnect timer already pending for this
    // session — the timer's own firing already cleared itself before calling
    // back in here, so this is a no-op in that case.
    clearPaneReconnectTimer(sessionId);

    const materializedSessionId = getMaterializedSessionId(sessionId);
    const baselineHandle = materializedSessionId
      ? getSessionStreamHandle(materializedSessionId)
      : null;
    const existingLease = paneStreamLeaseRef.current;
    const continuingPaneLease = !!existingLease
      && existingLease.clientSessionId === sessionId
      && existingLease.materializedSessionId === materializedSessionId
      && existingLease.handle === baselineHandle;
    const streamConnectionState = getSessionRecord(sessionId)?.streamConnectionState ?? null;
    const attempt: PaneStreamAttempt = {
      clientSessionId: sessionId,
      materializedSessionId,
      baselineHandle,
      mayOwnOpenedHandle: !isHotSessionClientId(sessionId) && (
        continuingPaneLease
        || (!baselineHandle
          && streamConnectionState !== "connecting"
          && streamConnectionState !== "open")
      ),
      token: Symbol("agents-pane-stream-attempt"),
    };
    paneStreamAttemptRef.current = attempt;
    setStreamRequestPending(true);
    void lifecycleCapabilitiesRef.current.ensureSessionStreamConnected(sessionId, {
      awaitOpen: true,
      reconnectOwner: "external",
      // The shared stream owns no reconnect policy for an external owner: it
      // only tells us the stream ended (see session-stream-connection-open's
      // onClose/onError and session-stream-connection-reconnect's external
      // branch, both of which bypass the internal working/needs_input gate
      // for external owners). The pane decides for itself whether to retry —
      // an idle child waiting on a parent message is exactly the case this
      // exists for.
      onReconnectNeeded: () => {
        if (guardRef.current.isClosed || !isCurrent(sessionId)) {
          // Closed or no-longer-current (unmounted/navigated-away) children
          // must not keep retrying.
          clearPaneReconnectTimer(sessionId);
          paneReconnectBackoffRef.current.delete(sessionId);
          return;
        }
        clearPaneReconnectTimer(sessionId);
        const nextBackoff = advanceReconnectBackoff(paneReconnectBackoffRef.current.get(sessionId));
        paneReconnectBackoffRef.current.set(sessionId, nextBackoff);
        setReconnectState(nextBackoff);
        const delayMs = nextBackoff.nextDelayMs;
        const timer = setTimeout(() => {
          if (paneReconnectTimerRef.current?.sessionId === sessionId) {
            paneReconnectTimerRef.current = null;
          }
          if (guardRef.current.isClosed || !isCurrent(sessionId)) {
            return;
          }
          if (paneStreamAttemptRef.current?.clientSessionId === sessionId) {
            paneStreamAttemptRef.current = null;
          }
          connectPaneStream(sessionId);
        }, delayMs);
        paneReconnectTimerRef.current = { sessionId, timer };
      },
      isCurrent: () => !guardRef.current.isClosed && isCurrent(sessionId),
    }).then(() => {
      if (paneStreamAttemptRef.current?.token !== attempt.token || !isCurrent(sessionId)) {
        return;
      }
      // A successful (non-throwing) resolution means the pane's own retry
      // policy no longer needs to escalate its backoff.
      paneReconnectBackoffRef.current.delete(sessionId);
      setReconnectState({ attempt: 0, nextDelayMs: 0, reconnecting: false });
      if (!attempt.mayOwnOpenedHandle || isHotSessionClientId(sessionId)) {
        return;
      }
      const currentMaterializedSessionId = getMaterializedSessionId(sessionId);
      if (!currentMaterializedSessionId) {
        return;
      }
      const currentHandle = getSessionStreamHandle(currentMaterializedSessionId);
      if (!currentHandle) {
        return;
      }
      paneStreamLeaseRef.current = {
        clientSessionId: sessionId,
        materializedSessionId: currentMaterializedSessionId,
        handle: currentHandle,
      };
    }).catch(() => {
      const record = getSessionRecord(sessionId);
      if (
        isCurrent(sessionId)
        && record
        && record.streamConnectionState !== "open"
        && !isHotSessionClientId(sessionId)
      ) {
        patchSessionRecord(sessionId, { streamConnectionState: "disconnected" });
      }
    }).finally(() => {
      if (paneStreamAttemptRef.current?.token === attempt.token) {
        paneStreamAttemptRef.current = null;
      }
      if (isCurrent(sessionId)) {
        setStreamRequestPending(false);
      }
    });
  }, [clearPaneReconnectTimer, isCurrent]);

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
      releasePaneStream(sessionId);
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
    releasePaneStream,
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
    reconnectState: isClosed
      ? { attempt: 0, nextDelayMs: 0, reconnecting: false }
      : reconnectState,
    sessionViewState,
    retryHistory,
    reconnect,
  };
}
