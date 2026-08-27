import { describe, expect, it, vi } from "vitest";
import {
  createSeatLimitHitRelay,
  type SeatLimitHitObservation,
} from "./seat-limit-relay";

function flushAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function observation(
  overrides: Partial<SeatLimitHitObservation> = {},
): SeatLimitHitObservation {
  return {
    sessionId: "session-1",
    seq: 7,
    seatId: "seat-1",
    window: "five_hour",
    resetAt: "2026-08-27T18:00:00Z",
    ...overrides,
  };
}

describe("createSeatLimitHitRelay", () => {
  it("posts (seatId, {window, resetAt}) exactly once per distinct error event", async () => {
    const post = vi.fn().mockResolvedValue(undefined);
    const relay = createSeatLimitHitRelay(post);

    expect(relay.relay(observation())).toBe(true);
    // Same (session, seq) — a replayed envelope reports nothing.
    expect(relay.relay(observation())).toBe(false);
    // A different event on the same session reports again.
    expect(relay.relay(observation({ seq: 9, window: "seven_day" }))).toBe(true);
    // The same seq on another session is a distinct event.
    expect(relay.relay(observation({ sessionId: "session-2" }))).toBe(true);

    await flushAsync();
    expect(post).toHaveBeenCalledTimes(3);
    expect(post).toHaveBeenNthCalledWith(1, "seat-1", {
      window: "five_hour",
      resetAt: "2026-08-27T18:00:00Z",
    });
    expect(post).toHaveBeenNthCalledWith(2, "seat-1", {
      window: "seven_day",
      resetAt: "2026-08-27T18:00:00Z",
    });
  });

  it("swallows a failed post and never retries it", async () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    try {
      const post = vi.fn().mockRejectedValue(new Error("network down"));
      const relay = createSeatLimitHitRelay(post);

      expect(relay.relay(observation())).toBe(true);
      // Flush the fire-and-forget chain (then + catch).
      await flushAsync();

      expect(post).toHaveBeenCalledTimes(1);
      expect(debug).toHaveBeenCalledTimes(1);
      // The dedupe entry stays: one attempt per event, no retry loop.
      expect(relay.relay(observation())).toBe(false);
      expect(post).toHaveBeenCalledTimes(1);
    } finally {
      debug.mockRestore();
    }
  });

  it("never throws into the caller when the poster throws synchronously", async () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    try {
      const relay = createSeatLimitHitRelay(() => {
        throw new Error("boom");
      });
      expect(() => relay.relay(observation())).not.toThrow();
      // Drain the swallowed rejection before restoring the spy.
      await flushAsync();
      expect(debug).toHaveBeenCalledTimes(1);
    } finally {
      debug.mockRestore();
    }
  });
});
