import type { LoopCapabilities, LoopWire } from "@proliferate/product-domain/activity/loop";
import type { ActivityProcessWire } from "@proliferate/product-domain/activity/process";
import type { ActivitySubagentWire } from "@proliferate/product-domain/activity/subagent";

export const ACTIVITY_FIXTURE_NOW_MS = 1_751_450_100_000; // 2026-07-02T10:15:00.000Z

function loopFixture(overrides: Partial<LoopWire>): LoopWire {
  return {
    loopId: "cron-1",
    prompt: "append ping + timestamp to PING.log",
    schedule: { kind: "cron", expr: "*/5 * * * *" },
    recurring: true,
    status: "active",
    native: true,
    lastFiredAtMs: null,
    fireCount: 0,
    updatedAtMs: ACTIVITY_FIXTURE_NOW_MS - 300_000,
    ...overrides,
  };
}

function processFixture(overrides: Partial<ActivityProcessWire>): ActivityProcessWire {
  return {
    id: "proc-1",
    command: "sleep 30 && echo OK > out.txt",
    cwd: "~/repo",
    status: { status: "running" },
    pid: null,
    startedAt: "2026-07-02T10:10:00.000Z",
    endedAt: null,
    feed: { feedId: "feed-proc-1", kind: "terminal_bytes" },
    ...overrides,
  };
}

function subagentFixture(overrides: Partial<ActivitySubagentWire>): ActivitySubagentWire {
  return {
    id: "task-1",
    agentType: "general-purpose",
    description: "API surface check",
    model: "claude-opus-4",
    background: true,
    status: { status: "running" },
    usage: null,
    feed: { feedId: "feed-task-1", kind: "transcript" },
    ...overrides,
  };
}

/** Claude-shaped: native session crons. */
export const LOOP_CAPABILITIES_NATIVE: LoopCapabilities = { supported: true, native: true };
/** Codex-shaped: runtime-emulated, not sidecar-native. */
export const LOOP_CAPABILITIES_EMULATED: LoopCapabilities = { supported: true, native: false };
export const LOOP_CAPABILITIES_UNSUPPORTED: LoopCapabilities = { supported: false, native: false };

export const LOOP_SINGLE_NATIVE = loopFixture({
  loopId: "cron-1",
  fireCount: 4,
  lastFiredAtMs: ACTIVITY_FIXTURE_NOW_MS - 60_000,
});

export const LOOPS_MANY = [
  loopFixture({
    loopId: "cron-1",
    prompt: "append ping + timestamp to PING.log",
    schedule: { kind: "cron", expr: "*/5 * * * *" },
    fireCount: 4,
    lastFiredAtMs: ACTIVITY_FIXTURE_NOW_MS - 60_000,
  }),
  loopFixture({
    loopId: "cron-2",
    prompt: "check CI status and post a one-line summary to the transcript",
    schedule: { kind: "interval", expr: "15m" },
    fireCount: 1,
    lastFiredAtMs: ACTIVITY_FIXTURE_NOW_MS - 900_000,
  }),
  loopFixture({
    loopId: "cron-3",
    prompt: "review the open PR queue for anything blocked on me",
    schedule: { kind: "cron", expr: "0 */2 * * *" },
    fireCount: 0,
    lastFiredAtMs: null,
    updatedAtMs: ACTIVITY_FIXTURE_NOW_MS - 30_000,
  }),
];

export const LOOP_EMULATED = loopFixture({
  loopId: "loop-codex-1",
  prompt: "poll the deploy status and report back",
  schedule: { kind: "interval", expr: "10m" },
  native: false,
  fireCount: 2,
  lastFiredAtMs: ACTIVITY_FIXTURE_NOW_MS - 600_000,
});

export const LOOPS_FIRED_SEQUENCE = [
  loopFixture({
    loopId: "cron-fired",
    prompt: "append ping + timestamp to PING.log",
    schedule: { kind: "interval", expr: "1m" },
    fireCount: 12,
    lastFiredAtMs: ACTIVITY_FIXTURE_NOW_MS - 30_000,
  }),
];

export const PROCESS_RUNNING = processFixture({});

export const PROCESS_EXITED_SUCCESS = processFixture({
  id: "proc-2",
  command: "npm run build",
  status: { status: "exited", exitCode: 0 },
  startedAt: "2026-07-02T10:05:00.000Z",
  endedAt: "2026-07-02T10:07:30.000Z",
});

export const PROCESS_EXITED_FAILURE = processFixture({
  id: "proc-3",
  command: "pytest tests/live_sessions",
  pid: 48213,
  status: { status: "exited", exitCode: 1 },
  startedAt: "2026-07-02T10:00:00.000Z",
  endedAt: "2026-07-02T10:01:12.000Z",
});

export const PROCESSES_MIXED = [PROCESS_RUNNING, PROCESS_EXITED_SUCCESS, PROCESS_EXITED_FAILURE];

export const SUBAGENT_RUNNING = subagentFixture({});

export const SUBAGENT_COMPLETED = subagentFixture({
  id: "task-2",
  description: "Docs pass over the new auth flow",
  status: { status: "completed", summary: "Updated 3 docs pages; flagged one stale diagram." },
  usage: { tokensUsed: 41_200, toolCalls: 18, durationSeconds: 210 },
});

export const SUBAGENT_FAILED = subagentFixture({
  id: "task-3",
  description: "Flaky test triage",
  status: { status: "failed" },
  usage: { tokensUsed: 8_400, toolCalls: 5, durationSeconds: 40 },
});

export const AGENTS_MIXED = [SUBAGENT_RUNNING, SUBAGENT_COMPLETED, SUBAGENT_FAILED];

export interface ActivityFixtureState {
  loops: LoopWire[];
  loopCapabilities: LoopCapabilities;
  processes: ActivityProcessWire[];
  agents: ActivitySubagentWire[];
}

function activityFixture(overrides: Partial<ActivityFixtureState> = {}): ActivityFixtureState {
  return {
    loops: [],
    loopCapabilities: LOOP_CAPABILITIES_UNSUPPORTED,
    processes: [],
    agents: [],
    ...overrides,
  };
}

export type ActivityFixtureKey =
  | "loops-single-native"
  | "loops-many"
  | "loops-emulated"
  | "loops-fired-sequence"
  | "terminals-running"
  | "terminals-mixed"
  | "agents-mixed"
  | "all-kinds";

export const ACTIVITY_FIXTURES: Record<ActivityFixtureKey, ActivityFixtureState> = {
  "loops-single-native": activityFixture({
    loops: [LOOP_SINGLE_NATIVE],
    loopCapabilities: LOOP_CAPABILITIES_NATIVE,
  }),
  "loops-many": activityFixture({
    loops: LOOPS_MANY,
    loopCapabilities: LOOP_CAPABILITIES_NATIVE,
  }),
  "loops-emulated": activityFixture({
    loops: [LOOP_EMULATED],
    loopCapabilities: LOOP_CAPABILITIES_EMULATED,
  }),
  "loops-fired-sequence": activityFixture({
    loops: LOOPS_FIRED_SEQUENCE,
    loopCapabilities: LOOP_CAPABILITIES_NATIVE,
  }),
  "terminals-running": activityFixture({ processes: [PROCESS_RUNNING] }),
  "terminals-mixed": activityFixture({ processes: PROCESSES_MIXED }),
  "agents-mixed": activityFixture({ agents: AGENTS_MIXED }),
  "all-kinds": activityFixture({
    loops: LOOPS_MANY,
    loopCapabilities: LOOP_CAPABILITIES_NATIVE,
    processes: PROCESSES_MIXED,
    agents: AGENTS_MIXED,
  }),
};

export function resolveActivityFixture(raw: string | undefined): ActivityFixtureState | null {
  if (!raw) {
    return null;
  }
  const key = raw.trim();
  return key in ACTIVITY_FIXTURES ? ACTIVITY_FIXTURES[key as ActivityFixtureKey] : null;
}
