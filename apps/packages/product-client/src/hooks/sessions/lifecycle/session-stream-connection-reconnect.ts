import {
  clearSessionReconnectTimer,
  currentSessionReconnectAttempt,
  nextSessionReconnectDelayMs,
  registerOfflineSessionReconnect,
  scheduleSessionReconnectTimer,
} from "#product/lib/workflows/sessions/session-reconnect-state";
import { recordSessionStreamReconnectScheduled } from "#product/lib/infra/diagnostics/renderer-diagnostic-migrations";
import { isConnectivityOnline } from "#product/stores/infra/connectivity-store";
import { shouldReconnectStream } from "#product/hooks/sessions/lifecycle/session-runtime-helpers";
import type {
  RefreshSessionSlotMeta,
  SessionStreamConnectOptions,
} from "#product/hooks/sessions/lifecycle/session-stream-connection-types";

interface ScheduleSessionStreamReconnectInput {
  sessionId: string;
  delayMs?: number;
  options: SessionStreamConnectOptions | undefined;
  refreshSessionSlotMeta: RefreshSessionSlotMeta;
  ensureSessionStreamConnected: (
    sessionId: string,
    options?: SessionStreamConnectOptions,
  ) => Promise<void>;
  isStillCurrent: () => boolean;
}

export function scheduleSessionStreamReconnect({
  sessionId,
  delayMs = 350,
  options,
  refreshSessionSlotMeta,
  ensureSessionStreamConnected,
  isStillCurrent,
}: ScheduleSessionStreamReconnectInput): void {
  clearSessionReconnectTimer(sessionId);
  if (!isStillCurrent()) {
    return;
  }
  // External owners (e.g. the Agents pane) decide their own reconnect policy
  // and must be notified even for a session the shared working/needs_input
  // gate below would otherwise treat as not worth auto-reconnecting (an idle
  // child waiting on a parent message never satisfies that gate). Internal
  // callers keep the existing gated auto-reconnect behavior unchanged.
  if (options?.reconnectOwner === "external") {
    options.onReconnectNeeded?.();
    return;
  }
  if (!shouldReconnectStream(sessionId)) {
    return;
  }

  const runner = () => {
    if (!isStillCurrent() || !shouldReconnectStream(sessionId)) {
      return;
    }

    void refreshSessionSlotMeta(sessionId, {
      resumeIfActive: true,
      isCurrent: options?.isCurrent,
    })
      .finally(() => {
        if (isStillCurrent()) {
          void ensureSessionStreamConnected(sessionId, {
            isCurrent: options?.isCurrent,
          });
        }
      });
  };

  // If offline, park the runner instead of spinning a timer — it will fire
  // once the online transition triggers flushOfflineSessionReconnects.
  if (!isConnectivityOnline()) {
    registerOfflineSessionReconnect(sessionId, runner);
    return;
  }

  const backoffDelay = nextSessionReconnectDelayMs(sessionId, delayMs);
  recordSessionStreamReconnectScheduled({
    sessionId,
    // nextSessionReconnectDelayMs has already counted this attempt, so the
    // post-increment value is the 1-based number of the reconnect being armed.
    attempt: currentSessionReconnectAttempt(sessionId),
    delayMs: backoffDelay,
  });
  scheduleSessionReconnectTimer(sessionId, runner, backoffDelay);
}
