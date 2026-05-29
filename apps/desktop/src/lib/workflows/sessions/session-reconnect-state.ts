const sessionReconnectTimers = new Map<string, number>();

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
