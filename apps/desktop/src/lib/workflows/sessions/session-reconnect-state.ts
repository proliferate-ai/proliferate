const sessionReconnectTimers = new Map<string, number>();

// Per-session count of consecutive reconnect attempts since the last successful
// open. Drives exponential backoff so a persistently-failing session does not
// hammer the runtime every 350ms forever.
const sessionReconnectAttempts = new Map<string, number>();

// Reconnect runners parked while the app is offline. We do not spin timers when
// navigator reports offline; instead we stash the runner and fire it the moment
// connectivity is restored (see flushOfflineSessionReconnects).
const offlineSessionReconnects = new Map<string, () => void>();

const RECONNECT_BACKOFF_CAP_MS = 15_000;

export function clearSessionReconnectTimer(sessionId: string): void {
  const timerId = sessionReconnectTimers.get(sessionId);
  if (timerId !== undefined) {
    window.clearTimeout(timerId);
    sessionReconnectTimers.delete(sessionId);
  }
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
 * Returns the delay for the next reconnect attempt using exponential backoff
 * (baseDelayMs, doubling per attempt, capped at 15s) and records that an
 * attempt was scheduled. Reset with resetSessionReconnectBackoff on a
 * successful open.
 */
export function nextSessionReconnectDelayMs(
  sessionId: string,
  baseDelayMs: number,
): number {
  const attempt = sessionReconnectAttempts.get(sessionId) ?? 0;
  const delay = Math.min(baseDelayMs * 2 ** attempt, RECONNECT_BACKOFF_CAP_MS);
  sessionReconnectAttempts.set(sessionId, attempt + 1);
  return delay;
}

export function resetSessionReconnectBackoff(sessionId: string): void {
  sessionReconnectAttempts.delete(sessionId);
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
