import { describe, expect, it } from "vitest";
import {
  cronNextFireAtMs,
  humanizeLoopCadence,
  loopNextFireAtMs,
  parseCronExpr,
  parseIntervalSugarMs,
  parseLoopWire,
  relativeFutureTimeLabel,
  sortLoopsForDisplay,
  type LoopWire,
} from "./loop";

function loop(overrides: Partial<LoopWire> = {}): LoopWire {
  return {
    loopId: "cron-1",
    prompt: "append ping + timestamp to PING.log",
    schedule: { kind: "cron", expr: "*/1 * * * *" },
    recurring: true,
    status: "active",
    native: true,
    lastFiredAtMs: null,
    fireCount: 0,
    updatedAtMs: 1_751_450_000_000,
    ...overrides,
  };
}

describe("parseLoopWire", () => {
  it("round-trips a full wire payload", () => {
    const wire = loop({ lastFiredAtMs: 1_751_450_100_000, fireCount: 2 });
    expect(parseLoopWire(JSON.parse(JSON.stringify(wire)))).toEqual(wire);
  });

  it("treats an absent lastFiredAtMs as null", () => {
    const parsed = parseLoopWire({
      loopId: "cron-2",
      prompt: "check every 5m",
      schedule: { kind: "interval", expr: "5m" },
      recurring: true,
      status: "active",
      native: false,
      fireCount: 0,
      updatedAtMs: 1,
    });
    expect(parsed).toEqual(loop({
      loopId: "cron-2",
      prompt: "check every 5m",
      schedule: { kind: "interval", expr: "5m" },
      native: false,
      updatedAtMs: 1,
    }));
  });

  it("rejects unknown statuses and malformed schedules", () => {
    expect(parseLoopWire({ ...loop(), status: "armed" })).toBeNull();
    expect(parseLoopWire({ ...loop(), schedule: { kind: "weird", expr: "x" } })).toBeNull();
    expect(parseLoopWire({ ...loop(), schedule: null })).toBeNull();
  });

  it("rejects non-object payloads", () => {
    expect(parseLoopWire(null)).toBeNull();
    expect(parseLoopWire("loop")).toBeNull();
    expect(parseLoopWire(42)).toBeNull();
  });
});

describe("sortLoopsForDisplay", () => {
  it("puts active loops before cleared ones, most-recently-fired first", () => {
    const older = loop({ loopId: "a", lastFiredAtMs: 100 });
    const newer = loop({ loopId: "b", lastFiredAtMs: 200 });
    const cleared = loop({ loopId: "c", status: "cleared", updatedAtMs: 300 });
    expect(sortLoopsForDisplay([older, cleared, newer]).map((l) => l.loopId)).toEqual([
      "b",
      "a",
      "c",
    ]);
  });
});

describe("parseIntervalSugarMs", () => {
  it("parses seconds/minutes/hours/days", () => {
    expect(parseIntervalSugarMs("30s")).toBe(30_000);
    expect(parseIntervalSugarMs("5m")).toBe(300_000);
    expect(parseIntervalSugarMs("2h")).toBe(7_200_000);
    expect(parseIntervalSugarMs("1d")).toBe(86_400_000);
  });

  it("rejects malformed or zero expressions", () => {
    expect(parseIntervalSugarMs("5")).toBeNull();
    expect(parseIntervalSugarMs("5 minutes")).toBeNull();
    expect(parseIntervalSugarMs("0m")).toBeNull();
  });
});

describe("parseCronExpr + cronNextFireAtMs", () => {
  it("rejects malformed expressions", () => {
    expect(parseCronExpr("* * * *")).toBeNull();
    expect(parseCronExpr("*/0 * * * *")).toBeNull();
    expect(parseCronExpr("60 * * * *")).toBeNull();
  });

  it("computes the next */N minute fire", () => {
    const from = Date.UTC(2026, 6, 2, 10, 3, 30); // 10:03:30
    const next = cronNextFireAtMs("*/5 * * * *", from);
    expect(next).toBe(Date.UTC(2026, 6, 2, 10, 5, 0));
  });

  it("computes the next daily fire crossing midnight", () => {
    const from = Date.UTC(2026, 6, 2, 23, 30, 0);
    const next = cronNextFireAtMs("0 0 * * *", from);
    expect(next).toBe(Date.UTC(2026, 6, 3, 0, 0, 0));
  });

  it("returns null for an unparseable expression", () => {
    expect(cronNextFireAtMs("not a cron", Date.now())).toBeNull();
  });
});

describe("loopNextFireAtMs", () => {
  it("returns null for cleared loops", () => {
    expect(loopNextFireAtMs(loop({ status: "cleared" }), Date.now())).toBeNull();
  });

  it("anchors interval loops off the last fire", () => {
    const l = loop({
      schedule: { kind: "interval", expr: "5m" },
      lastFiredAtMs: Date.UTC(2026, 6, 2, 10, 0, 0),
    });
    const now = Date.UTC(2026, 6, 2, 10, 6, 30);
    expect(loopNextFireAtMs(l, now)).toBe(Date.UTC(2026, 6, 2, 10, 10, 0));
  });

  it("anchors interval loops off arm time before the first fire", () => {
    const l = loop({
      schedule: { kind: "interval", expr: "1m" },
      lastFiredAtMs: null,
      updatedAtMs: Date.UTC(2026, 6, 2, 10, 0, 0),
    });
    const now = Date.UTC(2026, 6, 2, 9, 59, 0); // before arm time (fixture clock skew)
    expect(loopNextFireAtMs(l, now)).toBe(Date.UTC(2026, 6, 2, 10, 1, 0));
  });

  it("delegates cron loops to cronNextFireAtMs", () => {
    const l = loop({ schedule: { kind: "cron", expr: "*/10 * * * *" } });
    const now = Date.UTC(2026, 6, 2, 10, 3, 0);
    expect(loopNextFireAtMs(l, now)).toBe(Date.UTC(2026, 6, 2, 10, 10, 0));
  });
});

describe("humanizeLoopCadence", () => {
  it("humanizes interval sugar", () => {
    expect(humanizeLoopCadence({ kind: "interval", expr: "5m" })).toBe("every 5 minutes");
    expect(humanizeLoopCadence({ kind: "interval", expr: "1h" })).toBe("every 1 hour");
  });

  it("humanizes common cron step patterns", () => {
    expect(humanizeLoopCadence({ kind: "cron", expr: "* * * * *" })).toBe("every minute");
    expect(humanizeLoopCadence({ kind: "cron", expr: "*/1 * * * *" })).toBe("every 1 minute");
    expect(humanizeLoopCadence({ kind: "cron", expr: "*/15 * * * *" })).toBe("every 15 minutes");
    expect(humanizeLoopCadence({ kind: "cron", expr: "0 */2 * * *" })).toBe("every 2 hours");
  });

  it("falls back to the raw cron expression otherwise", () => {
    expect(humanizeLoopCadence({ kind: "cron", expr: "30 9 * * 1-5" })).toBe("cron 30 9 * * 1-5");
  });
});

describe("relativeFutureTimeLabel", () => {
  it("labels seconds/minutes/hours/days ahead", () => {
    const now = 1_000_000;
    expect(relativeFutureTimeLabel(now + 30_000, now)).toBe("in 30s");
    expect(relativeFutureTimeLabel(now + 5 * 60_000, now)).toBe("in 5m");
    expect(relativeFutureTimeLabel(now + 3 * 3_600_000, now)).toBe("in 3h");
    expect(relativeFutureTimeLabel(now + 2 * 86_400_000, now)).toBe("in 2d");
  });

  it("labels past-or-now as due", () => {
    expect(relativeFutureTimeLabel(1_000, 1_000)).toBe("due");
    expect(relativeFutureTimeLabel(500, 1_000)).toBe("due");
  });
});
