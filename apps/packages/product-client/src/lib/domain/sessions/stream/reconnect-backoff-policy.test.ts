import { describe, expect, it } from "vitest";
import {
  RECONNECT_BACKOFF_BASE_DELAY_MS,
  RECONNECT_BACKOFF_CAP_MS,
  RECONNECT_BACKOFF_FACTOR,
  advanceReconnectBackoff,
  reconnectBackoffDelayForAttempt,
} from "#product/lib/domain/sessions/stream/reconnect-backoff-policy";
import { nextSessionReconnectDelayMs, resetSessionReconnectBackoff } from "#product/lib/workflows/sessions/session-reconnect-state";

const EXPECTED_CURVE = [350, 700, 1400, 2800, 5600, 11200, 15000, 15000, 15000];

describe("reconnect backoff policy constants", () => {
  it("matches the ADR §4.7 Rung 7 (Q9) ruling: base 350ms, factor 2, cap 15s", () => {
    expect(RECONNECT_BACKOFF_BASE_DELAY_MS).toBe(350);
    expect(RECONNECT_BACKOFF_FACTOR).toBe(2);
    expect(RECONNECT_BACKOFF_CAP_MS).toBe(15_000);
  });
});

describe("reconnectBackoffDelayForAttempt (jitter-free curve)", () => {
  it("produces the exact attempt sequence 350, 700, 1400, 2800, 5600, 11200, 15000, 15000...", () => {
    const curve = EXPECTED_CURVE.map((_, attempt) => reconnectBackoffDelayForAttempt(attempt));
    expect(curve).toEqual(EXPECTED_CURVE);
  });
});

describe("advanceReconnectBackoff with jitter neutralized (rng = () => 0)", () => {
  it("yields the same bare curve as reconnectBackoffDelayForAttempt", () => {
    const zeroRng = () => 0;
    let state: { attempt: number } | undefined;
    const delays: number[] = [];
    for (let i = 0; i < EXPECTED_CURVE.length; i += 1) {
      const next = advanceReconnectBackoff(state, zeroRng);
      delays.push(next.nextDelayMs);
      state = next;
    }
    expect(delays).toEqual(EXPECTED_CURVE);
  });
});

// T1 gate: both consumers of the shared policy must yield the identical
// curve. session-reconnect-state.ts (used by the primary session stream) is
// exercised directly here; the agents-pane hook exercises the same
// advanceReconnectBackoff entry point (see
// use-agents-pane-session-lifecycle.ts's onReconnectNeeded), asserted below
// via the same policy function it calls.
describe("T1: session-stream and agents-pane consumers share one curve", () => {
  it("session-reconnect-state.ts (session stream) matches the exact curve, jitter neutralized", () => {
    const sessionId = "t1-session-stream-curve";
    resetSessionReconnectBackoff(sessionId);
    // nextSessionReconnectDelayMs uses Math.random-based jitter by default;
    // pin Math.random to 0 for this assertion window so the curve is exact.
    const originalRandom = Math.random;
    Math.random = () => 0;
    try {
      const delays = EXPECTED_CURVE.map(() => nextSessionReconnectDelayMs(sessionId));
      expect(delays).toEqual(EXPECTED_CURVE);
    } finally {
      Math.random = originalRandom;
      resetSessionReconnectBackoff(sessionId);
    }
  });

  it("agents-pane's advanceReconnectBackoff (same policy entry point) matches the exact curve, jitter neutralized", () => {
    const zeroRng = () => 0;
    let state: { attempt: number } | undefined;
    const delays: number[] = [];
    for (let i = 0; i < EXPECTED_CURVE.length; i += 1) {
      const next = advanceReconnectBackoff(state, zeroRng);
      delays.push(next.nextDelayMs);
      state = next;
    }
    expect(delays).toEqual(EXPECTED_CURVE);
  });
});
