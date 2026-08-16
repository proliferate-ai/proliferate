import {
  clearSessionReconnectTimer,
  currentSessionReconnectAttempt,
  nextSessionReconnectDelayMs,
  registerOfflineSessionReconnect,
  scheduleSessionReconnectTimer,
} from "#product/lib/workflows/sessions/session-reconnect-state";
import { recordSessionStreamReconnectScheduled } from "#product/lib/infra/diagnostics/renderer-diagnostics-connection";
import { isConnectivityOnline } from "#product/stores/infra/connectivity-store";
import { shouldReconnectStream } from "#product/hooks/sessions/lifecycle/session-runtime-helpers";
import type {
  RefreshSessionSlotMeta,
  SessionStreamConnectOptions,
} from "#product/hooks/sessions/lifecycle/session-stream-connection-types";

interface ScheduleSessionStreamReconnectInput {
  sessionId: string;
  options: SessionStreamConnectOptions | undefined;
  refreshSessionSlotMeta: RefreshSessionSlotMeta;
  ensureSessionStreamConnected: (
    sessionId: string,
    options?: SessionStreamConnectOptions,
  ) => Promise<void>;
  isStillCurrent: () => boolean;
  /**
   * Bypass-backoff fast path for a gap-reconcile forced close (Q9): fire on the
   * next tick without waiting on the shared error-retry curve and without
   * advancing the per-session attempt counter. Defaults to false (ordinary
   * error retry).
   */
  immediate?: boolean;
}

export function scheduleSessionStreamReconnect({
  sessionId,
  options,
  refreshSessionSlotMeta,
  ensureSessionStreamConnected,
  isStillCurrent,
  immediate = false,
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

  if (immediate) {
    // Gap-reconcile forced reconnect: do NOT advance the shared attempt counter
    // and do NOT wait on the curve — schedule on the next tick. The attempt
    // number reported is the unchanged current one.
    recordSessionStreamReconnectScheduled({
      sessionId,
      attempt: currentSessionReconnectAttempt(sessionId),
      delayMs: 0,
    });
    scheduleSessionReconnectTimer(sessionId, runner, 0);
    return;
  }

  const backoffDelay = nextSessionReconnectDelayMs(sessionId);
  recordSessionStreamReconnectScheduled({
    sessionId,
    // nextSessionReconnectDelayMs has already counted this attempt, so the
    // post-increment value is the 1-based number of the reconnect being armed.
    attempt: currentSessionReconnectAttempt(sessionId),
    delayMs: backoffDelay,
  });
  scheduleSessionReconnectTimer(sessionId, runner, backoffDelay);
}
