export interface LatestTimestampThrottle {
  record(key: string, timestamp: string): void;
  reset(): void;
}

interface LatestTimestampThrottleInput {
  intervalMs: number;
  write: (key: string, timestamp: string) => void;
  now?: () => number;
  schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  cancel?: (timerId: ReturnType<typeof setTimeout>) => void;
}

interface PendingTimestampWrite {
  timestamp: string;
  timerId: ReturnType<typeof setTimeout>;
}

export function createLatestTimestampThrottle({
  intervalMs,
  write,
  now = Date.now,
  schedule = (callback, delayMs) => setTimeout(callback, delayMs),
  cancel = clearTimeout,
}: LatestTimestampThrottleInput): LatestTimestampThrottle {
  const lastWriteAtByKey = new Map<string, number>();
  const pendingWritesByKey = new Map<string, PendingTimestampWrite>();

  const clearPending = (key: string) => {
    const pending = pendingWritesByKey.get(key);
    if (!pending) {
      return;
    }
    cancel(pending.timerId);
    pendingWritesByKey.delete(key);
  };

  const writeNow = (key: string, timestamp: string, writeAt: number) => {
    lastWriteAtByKey.set(key, writeAt);
    write(key, timestamp);
  };

  const record = (key: string, timestamp: string) => {
    const writeAt = now();
    const lastWriteAt = lastWriteAtByKey.get(key);
    if (lastWriteAt === undefined || writeAt - lastWriteAt >= intervalMs) {
      clearPending(key);
      writeNow(key, timestamp, writeAt);
      return;
    }

    const pending = pendingWritesByKey.get(key);
    const nextTimestamp = latestIsoTimestamp(pending?.timestamp ?? null, timestamp);
    if (pending) {
      pending.timestamp = nextTimestamp;
      return;
    }

    const delayMs = intervalMs - (writeAt - lastWriteAt);
    const timerId = schedule(() => {
      const latestPending = pendingWritesByKey.get(key);
      if (!latestPending) {
        return;
      }
      pendingWritesByKey.delete(key);
      writeNow(key, latestPending.timestamp, now());
    }, delayMs);
    pendingWritesByKey.set(key, {
      timestamp: nextTimestamp,
      timerId,
    });
  };

  const reset = () => {
    for (const pending of pendingWritesByKey.values()) {
      cancel(pending.timerId);
    }
    pendingWritesByKey.clear();
    lastWriteAtByKey.clear();
  };

  return {
    record,
    reset,
  };
}

function latestIsoTimestamp(current: string | null, next: string): string {
  if (!current) {
    return next;
  }
  const currentTime = Date.parse(current);
  const nextTime = Date.parse(next);
  if (Number.isNaN(currentTime) || Number.isNaN(nextTime)) {
    return next;
  }
  return nextTime >= currentTime ? next : current;
}
