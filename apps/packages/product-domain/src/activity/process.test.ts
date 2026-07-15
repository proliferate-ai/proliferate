import { describe, expect, it } from "vitest";
import {
  isProcessRunning,
  parseActivityProcessWire,
  processElapsedLabel,
  processStatusLabel,
  processStatusTone,
  sortProcessesForDisplay,
  type ActivityProcessWire,
} from "./process";

function process(overrides: Partial<ActivityProcessWire> = {}): ActivityProcessWire {
  return {
    id: "proc-1",
    command: "sleep 30 && echo OK > out.txt",
    cwd: "/repo",
    status: { status: "running" },
    pid: null,
    startedAt: "2026-07-02T10:00:00.000Z",
    endedAt: null,
    feed: { feedId: "feed-1", kind: "terminal_bytes" },
    ...overrides,
  };
}

describe("parseActivityProcessWire", () => {
  it("round-trips a full wire payload", () => {
    const wire = process({ status: { status: "exited", exitCode: 0 }, endedAt: "2026-07-02T10:00:30.000Z" });
    expect(parseActivityProcessWire(JSON.parse(JSON.stringify(wire)))).toEqual(wire);
  });

  it("treats absent optionals as null", () => {
    const parsed = parseActivityProcessWire({
      id: "proc-2",
      command: "echo hi",
      status: { status: "running" },
      startedAt: "2026-07-02T10:00:00.000Z",
    });
    expect(parsed).toEqual(process({
      id: "proc-2",
      command: "echo hi",
      cwd: null,
      feed: null,
    }));
  });

  it("rejects malformed status shapes", () => {
    expect(parseActivityProcessWire({ ...process(), status: { status: "paused" } })).toBeNull();
    expect(parseActivityProcessWire({ ...process(), status: null })).toBeNull();
  });

  it("rejects non-object payloads", () => {
    expect(parseActivityProcessWire(null)).toBeNull();
    expect(parseActivityProcessWire("proc")).toBeNull();
  });
});

describe("isProcessRunning / status label / tone", () => {
  it("labels running", () => {
    const p = process();
    expect(isProcessRunning(p)).toBe(true);
    expect(processStatusLabel(p)).toBe("Running");
    expect(processStatusTone(p)).toBe("default");
  });

  it("labels a clean exit as finished/positive", () => {
    const p = process({ status: { status: "exited", exitCode: 0 } });
    expect(isProcessRunning(p)).toBe(false);
    expect(processStatusLabel(p)).toBe("Finished");
    expect(processStatusTone(p)).toBe("positive");
  });

  it("labels a nonzero exit code as danger", () => {
    const p = process({ status: { status: "exited", exitCode: 1 } });
    expect(processStatusLabel(p)).toBe("Exited (1)");
    expect(processStatusTone(p)).toBe("danger");
  });

  it("labels an unknown exit code as muted", () => {
    const p = process({ status: { status: "exited", exitCode: null } });
    expect(processStatusLabel(p)).toBe("Exited");
    expect(processStatusTone(p)).toBe("muted");
  });
});

describe("processElapsedLabel", () => {
  it("counts up from start while running", () => {
    const p = process({ startedAt: "2026-07-02T10:00:00.000Z" });
    const now = Date.parse("2026-07-02T10:05:00.000Z");
    expect(processElapsedLabel(p, now)).toBe("5m");
  });

  it("shows total runtime once exited", () => {
    const p = process({
      status: { status: "exited", exitCode: 0 },
      startedAt: "2026-07-02T10:00:00.000Z",
      endedAt: "2026-07-02T10:00:30.000Z",
    });
    expect(processElapsedLabel(p, Date.parse("2026-07-02T11:00:00.000Z"))).toBe("now");
  });
});

describe("sortProcessesForDisplay", () => {
  it("puts running processes before exited ones, most-recently-started first", () => {
    const older = process({ id: "a", startedAt: "2026-07-02T09:00:00.000Z" });
    const newer = process({ id: "b", startedAt: "2026-07-02T10:00:00.000Z" });
    const exited = process({
      id: "c",
      status: { status: "exited", exitCode: 0 },
      startedAt: "2026-07-02T11:00:00.000Z",
    });
    expect(sortProcessesForDisplay([older, exited, newer]).map((p) => p.id)).toEqual([
      "b",
      "a",
      "c",
    ]);
  });
});
