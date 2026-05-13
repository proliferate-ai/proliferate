const pendingConfigRollbackTimers = new Map<string, number>();

export function clearPendingConfigRollbackCheck(sessionId: string): void {
  const timer = pendingConfigRollbackTimers.get(sessionId);
  if (timer === undefined) {
    return;
  }

  window.clearTimeout(timer);
  pendingConfigRollbackTimers.delete(sessionId);
}
