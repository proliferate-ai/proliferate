import {
  advanceReconnectBackoff,
  type ReconnectBackoffState,
} from "#product/lib/domain/sessions/stream/reconnect-backoff-policy";

const sessionReconnectTimers = new Map<string, number>();

// Per-session reconnect backoff state (attempt index, next delay, reconnecting
// flag) since the last successful open. The curve itself (base/factor/cap/
// jitter) lives in the shared reconnect-backoff-policy module; this map is
// just session-keyed storage for it.
const sessionReconnectBackoff = new Map<string, ReconnectBackoffState>();

// Reconnect runners parked while the app is offline. We do not spin timers when
// navigator reports offline; instead we stash the runner and fire it the moment
// connectivity is restored (see flushOfflineSessionReconnects).
const offlineSessionReconnects = new Map<string, () => void>();

export function clearSessionReconnectTimer(sessionId: string): void {
  const timerId = sessionReconnectTimers.get(sessionId);
  if (timerId !== undefined) {
    window.clearTimeout(timerId);
    sessionReconnectTimers.delete(sessionId);
  }
  // Also remove any parked offline runner so it cannot fire on the next
  // online flush after the session has been torn down.
  offlineSessionReconnects.delete(sessionId);
}

export function scheduleSessionReconnectTimer(
  sessionId: string,
  callback: () => void,
  delayMs: number,
): number {
  clearSessionReconnectTimer(sessionId);

  const timerId = window.setTimeout(() => {
    sessionReconnectTimers.delete(sessionId);
    callback();
  }, delayMs);

  sessionReconnectTimers.set(sessionId, timerId);
  return timerId;
}

/**
 * Returns the delay for the next reconnect attempt from the shared reconnect
 * backoff policy (base 350ms, factor 2, capped at 15s, jittered) and records
 * that an attempt was scheduled. Reset with resetSessionReconnectBackoff on a
 * successful open.
 */
export function nextSessionReconnectDelayMs(sessionId: string): number {
  const next = advanceReconnectBackoff(sessionReconnectBackoff.get(sessionId));
  sessionReconnectBackoff.set(sessionId, next);
  return next.nextDelayMs;
}

/**
 * Reconnect attempts recorded for this session since the last successful open.
 * Read-only view for diagnostics; it must be sampled before
 * resetSessionReconnectBackoff runs if the caller wants the attempt that won.
 */
export function currentSessionReconnectAttempt(sessionId: string): number {
  return sessionReconnectBackoff.get(sessionId)?.attempt ?? 0;
}

/**
 * Whether this session currently has a reconnect attempt scheduled/in-flight
 * (i.e. has not yet reconnected successfully since it last dropped). Shared
 * shape consumers surface as their "reconnecting" affordance state.
 */
export function isSessionReconnecting(sessionId: string): boolean {
  return sessionReconnectBackoff.get(sessionId)?.reconnecting ?? false;
}

export function resetSessionReconnectBackoff(sessionId: string): void {
  sessionReconnectBackoff.delete(sessionId);
  offlineSessionReconnects.delete(sessionId);
}

/**
 * Park a reconnect runner while offline. Registering a runner does not schedule
 * a timer; flushOfflineSessionReconnects runs it once connectivity returns.
 */
export function registerOfflineSessionReconnect(
  sessionId: string,
  runner: () => void,
): void {
  clearSessionReconnectTimer(sessionId);
  offlineSessionReconnects.set(sessionId, runner);
}

/** Fire every parked reconnect runner (called on the offline -> online edge). */
export function flushOfflineSessionReconnects(): void {
  if (offlineSessionReconnects.size === 0) {
    return;
  }
  const runners = Array.from(offlineSessionReconnects.values());
  offlineSessionReconnects.clear();
  for (const runner of runners) {
    runner();
  }
}
