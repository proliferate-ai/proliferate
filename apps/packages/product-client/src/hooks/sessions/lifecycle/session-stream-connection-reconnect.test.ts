import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { scheduleSessionStreamReconnect } from "#product/hooks/sessions/lifecycle/session-stream-connection-reconnect";
import {
  clearSessionReconnectTimer,
  currentSessionReconnectAttempt,
  isSessionReconnecting,
  resetSessionReconnectBackoff,
} from "#product/lib/workflows/sessions/session-reconnect-state";

// The reconnect scheduler gates on connectivity + the internal reconnect
// policy; keep both "green" so the tests exercise the backoff/immediate
// branches rather than the offline/skip branches.
vi.mock("#product/stores/infra/connectivity-store", () => ({
  isConnectivityOnline: () => true,
}));
vi.mock("#product/hooks/sessions/lifecycle/session-runtime-helpers", () => ({
  shouldReconnectStream: () => true,
}));
vi.mock("#product/lib/infra/diagnostics/renderer-diagnostics-connection", () => ({
  recordSessionStreamReconnectScheduled: vi.fn(),
}));

const SESSION_ID = "session-reconnect-test";

function callSchedule(immediate: boolean) {
  scheduleSessionStreamReconnect({
    sessionId: SESSION_ID,
    options: undefined,
    refreshSessionSlotMeta: vi.fn().mockResolvedValue(undefined),
    ensureSessionStreamConnected: vi.fn().mockResolvedValue(undefined),
    isStillCurrent: () => true,
    immediate,
  });
}

let scheduledDelays: (number | undefined)[] = [];

describe("scheduleSessionStreamReconnect immediate fast path", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    scheduledDelays = [];
    vi.stubGlobal("window", {
      setTimeout: (fn: () => void, ms?: number) => {
        scheduledDelays.push(ms);
        return setTimeout(fn, ms);
      },
      clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
    });
    resetSessionReconnectBackoff(SESSION_ID);
  });

  afterEach(() => {
    clearSessionReconnectTimer(SESSION_ID);
    resetSessionReconnectBackoff(SESSION_ID);
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("schedules an immediate (0ms) reconnect without advancing the backoff attempt", () => {
    expect(currentSessionReconnectAttempt(SESSION_ID)).toBe(0);

    callSchedule(true);

    // The gap-reconcile fast path must NOT advance the shared per-session
    // attempt counter (which would inflate later genuine error retries).
    expect(currentSessionReconnectAttempt(SESSION_ID)).toBe(0);
    expect(isSessionReconnecting(SESSION_ID)).toBe(false);

    // It arms the reconnect timer at 0ms, not on the 350ms+ backoff curve.
    expect(scheduledDelays).toEqual([0]);
  });

  it("negative control: an ordinary reconnect DOES advance the attempt counter and waits on the curve", () => {
    expect(currentSessionReconnectAttempt(SESSION_ID)).toBe(0);

    callSchedule(false);

    // The ordinary error-retry path advances the shared attempt counter.
    expect(currentSessionReconnectAttempt(SESSION_ID)).toBe(1);
    expect(isSessionReconnecting(SESSION_ID)).toBe(true);
    // And it waits on the curve (base 350ms + up to 20% jitter), never 0ms.
    expect(scheduledDelays).toHaveLength(1);
    expect(scheduledDelays[0]).toBeGreaterThanOrEqual(350);
  });
});
