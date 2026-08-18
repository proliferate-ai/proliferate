import { describe, expect, it } from "vitest";
import type { ActivityProcessWire } from "./process";
import type { ActivitySubagentWire } from "./subagent";
import {
  deriveNewCompletionReceipts,
  subagentReceiptKey,
  subagentReceiptVerb,
  terminalReceiptKey,
  terminalReceiptVerb,
} from "./background-completion-receipt";

function process(overrides: Partial<ActivityProcessWire> = {}): ActivityProcessWire {
  return {
    id: "proc-1",
    command: "pytest -q tests/e2e",
    cwd: null,
    status: { status: "running" },
    pid: null,
    startedAt: "2026-08-17T00:00:00.000Z",
    endedAt: null,
    feed: null,
    ...overrides,
  };
}

function agent(overrides: Partial<ActivitySubagentWire> = {}): ActivitySubagentWire {
  return {
    id: "task-1",
    agentType: "general",
    description: "audit the roster",
    model: null,
    background: true,
    status: { status: "running" },
    usage: null,
    feed: null,
    ...overrides,
  };
}

const NOW = 1_000;

describe("terminalReceiptVerb / subagentReceiptVerb", () => {
  it("renders the exit code in the terminal verb, matching the design artifact", () => {
    expect(terminalReceiptVerb(0)).toBe("exited 0 ·");
    expect(terminalReceiptVerb(130)).toBe("exited 130 ·");
    expect(terminalReceiptVerb(null)).toBe("exited ·");
  });

  it("uses finished/failed for the subagent verb", () => {
    expect(subagentReceiptVerb("completed")).toBe("finished ·");
    expect(subagentReceiptVerb("failed")).toBe("failed ·");
  });
});

describe("deriveNewCompletionReceipts", () => {
  it("emits a terminal receipt when a running process exits", () => {
    const exited = process({
      status: { status: "exited", exitCode: 0 },
      endedAt: "2026-08-17T00:01:00.000Z",
    });
    const receipts = deriveNewCompletionReceipts({
      previousRunningProcessIds: new Set(["proc-1"]),
      previousRunningAgentsById: new Map(),
      processes: [exited],
      agents: [],
      alreadyReceiptedKeys: new Set(),
      anchorTurnId: "turn-1",
      nowMs: NOW,
    });
    expect(receipts).toEqual([
      {
        kind: "terminal",
        key: terminalReceiptKey("proc-1"),
        processId: "proc-1",
        command: "pytest -q tests/e2e",
        exitCode: 0,
        atMs: Date.parse("2026-08-17T00:01:00.000Z"),
        anchorTurnId: "turn-1",
      },
    ]);
  });

  it("emits a subagent receipt when a running subagent vanishes from the roster", () => {
    const previous = agent({ id: "task-1" });
    const receipts = deriveNewCompletionReceipts({
      previousRunningProcessIds: new Set(),
      previousRunningAgentsById: new Map([["task-1", previous]]),
      processes: [],
      agents: [],
      alreadyReceiptedKeys: new Set(),
      anchorTurnId: "turn-1",
      nowMs: NOW,
    });
    expect(receipts).toEqual([
      {
        kind: "subagent",
        key: subagentReceiptKey("task-1"),
        subagentId: "task-1",
        title: "audit the roster",
        outcome: "completed",
        atMs: NOW,
        anchorTurnId: "turn-1",
      },
    ]);
  });

  // The anchor turn stamped in is the one that was latest when the completion
  // was folded — the row model interleaves the receipt right after it so it
  // reads before the wake turn (bgwork r6 round 2).
  it("stamps each receipt with the anchor turn passed in", () => {
    const exited = process({ status: { status: "exited", exitCode: 0 } });
    const [receipt] = deriveNewCompletionReceipts({
      previousRunningProcessIds: new Set(["proc-1"]),
      previousRunningAgentsById: new Map(),
      processes: [exited],
      agents: [],
      alreadyReceiptedKeys: new Set(),
      anchorTurnId: "turn-agent-42",
      nowMs: NOW,
    });
    expect(receipt.anchorTurnId).toBe("turn-agent-42");
  });

  it("stamps a null anchor when no turn exists yet", () => {
    const exited = process({ status: { status: "exited", exitCode: 0 } });
    const [receipt] = deriveNewCompletionReceipts({
      previousRunningProcessIds: new Set(["proc-1"]),
      previousRunningAgentsById: new Map(),
      processes: [exited],
      agents: [],
      alreadyReceiptedKeys: new Set(),
      anchorTurnId: null,
      nowMs: NOW,
    });
    expect(receipt.anchorTurnId).toBeNull();
  });

  it("prefers the final-status snapshot when the subagent lingers one tick as failed", () => {
    const previous = agent({ id: "task-1", status: { status: "running" } });
    const current = agent({ id: "task-1", status: { status: "failed" } });
    const receipts = deriveNewCompletionReceipts({
      previousRunningProcessIds: new Set(),
      previousRunningAgentsById: new Map([["task-1", previous]]),
      processes: [],
      agents: [current],
      alreadyReceiptedKeys: new Set(),
      anchorTurnId: "turn-1",
      nowMs: NOW,
    });
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ kind: "subagent", outcome: "failed" });
  });

  it("does NOT receipt a subagent that is still running", () => {
    const previous = agent({ id: "task-1" });
    const receipts = deriveNewCompletionReceipts({
      previousRunningProcessIds: new Set(),
      previousRunningAgentsById: new Map([["task-1", previous]]),
      processes: [],
      agents: [agent({ id: "task-1", status: { status: "running" } })],
      alreadyReceiptedKeys: new Set(),
      anchorTurnId: "turn-1",
      nowMs: NOW,
    });
    expect(receipts).toEqual([]);
  });

  // NEGATIVE CONTROL: work already finished at first sighting (never seen
  // running by this hook — e.g. the roster seed on mount) is NOT receipted.
  // Receipts announce completions observed while watching, never a backlog.
  it("does NOT receipt an exited process it never saw running (roster-seed backlog)", () => {
    const exited = process({
      status: { status: "exited", exitCode: 0 },
      endedAt: "2026-08-17T00:01:00.000Z",
    });
    const receipts = deriveNewCompletionReceipts({
      previousRunningProcessIds: new Set(), // never observed running
      previousRunningAgentsById: new Map(),
      processes: [exited],
      agents: [],
      alreadyReceiptedKeys: new Set(),
      anchorTurnId: "turn-1",
      nowMs: NOW,
    });
    expect(receipts).toEqual([]);
  });

  it("does NOT re-emit a completion already receipted on an earlier tick", () => {
    const exited = process({
      status: { status: "exited", exitCode: 0 },
      endedAt: "2026-08-17T00:01:00.000Z",
    });
    const receipts = deriveNewCompletionReceipts({
      previousRunningProcessIds: new Set(["proc-1"]),
      previousRunningAgentsById: new Map(),
      processes: [exited],
      agents: [],
      alreadyReceiptedKeys: new Set([terminalReceiptKey("proc-1")]),
      anchorTurnId: "turn-1",
      nowMs: NOW,
    });
    expect(receipts).toEqual([]);
  });
});
