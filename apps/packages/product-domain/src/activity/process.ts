/**
 * Activity process — pure mirror of `anyharness-contract v1::ActivityProcess`.
 * A harness-owned or client-executed background process the agent is
 * running (Claude background bash, Cursor detached terminals, …). Read-only
 * roster element: never externally settable, watchable via an opaque
 * `FeedRef` the UI never resolves the transport of.
 */

import { relativeTimeLabel } from "../workspaces/cloud-work-time";

export type ProcessStatus =
  | { status: "running" }
  | { status: "exited"; exitCode: number | null };

export type FeedKind = "terminal_bytes" | "transcript";

export interface FeedRefWire {
  feedId: string;
  kind: FeedKind;
}

export interface ActivityProcessWire {
  id: string;
  command: string;
  cwd: string | null;
  status: ProcessStatus;
  /** Cursor provides a real pid; Claude does not. */
  pid: number | null;
  startedAt: string;
  endedAt: string | null;
  feed: FeedRefWire | null;
}

export function isProcessRunning(process: Pick<ActivityProcessWire, "status">): boolean {
  return process.status.status === "running";
}

/**
 * Strict parse of a wire payload into an `ActivityProcessWire`. Returns null
 * on any shape violation.
 */
export function parseActivityProcessWire(value: unknown): ActivityProcessWire | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.command !== "string") {
    return null;
  }
  if (typeof record.startedAt !== "string") {
    return null;
  }
  const status = parseProcessStatus(record.status);
  if (!status) {
    return null;
  }
  const cwd = nullableString(record.cwd);
  const pid = nullableNumber(record.pid);
  const endedAt = nullableString(record.endedAt);
  if (cwd === undefined || pid === undefined || endedAt === undefined) {
    return null;
  }
  return {
    id: record.id,
    command: record.command,
    cwd,
    status,
    pid,
    startedAt: record.startedAt,
    endedAt,
    feed: parseFeedRefWire(record.feed) ?? null,
  };
}

function parseProcessStatus(value: unknown): ProcessStatus | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.status === "running") {
    return { status: "running" };
  }
  if (record.status === "exited") {
    const exitCode = nullableNumber(record.exitCode);
    return { status: "exited", exitCode: exitCode ?? null };
  }
  return null;
}

function parseFeedRefWire(value: unknown): FeedRefWire | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.feedId !== "string") {
    return null;
  }
  if (record.kind !== "terminal_bytes" && record.kind !== "transcript") {
    return null;
  }
  return { feedId: record.feedId, kind: record.kind };
}

function nullableString(value: unknown): string | null | undefined {
  if (value === null || value === undefined) {
    return null;
  }
  return typeof value === "string" ? value : undefined;
}

function nullableNumber(value: unknown): number | null | undefined {
  if (value === null || value === undefined) {
    return null;
  }
  return typeof value === "number" ? value : undefined;
}

export type ProcessTone = "default" | "positive" | "danger" | "muted";

export function processStatusLabel(process: Pick<ActivityProcessWire, "status">): string {
  if (process.status.status === "running") {
    return "Running";
  }
  const { exitCode } = process.status;
  if (exitCode === null || exitCode === undefined) {
    return "Exited";
  }
  return exitCode === 0 ? "Finished" : `Exited (${exitCode})`;
}

export function processStatusTone(process: Pick<ActivityProcessWire, "status">): ProcessTone {
  if (process.status.status === "running") {
    return "default";
  }
  const { exitCode } = process.status;
  if (exitCode === 0) {
    return "positive";
  }
  return exitCode ? "danger" : "muted";
}

/** Elapsed/duration label: running processes count up from start; exited ones show total runtime. */
export function processElapsedLabel(process: ActivityProcessWire, nowMs: number): string {
  const startedAtMs = Date.parse(process.startedAt) || 0;
  if (process.status.status === "running") {
    return relativeTimeLabel(startedAtMs, nowMs);
  }
  const endedAtMs = process.endedAt ? Date.parse(process.endedAt) || 0 : nowMs;
  return relativeTimeLabel(startedAtMs, endedAtMs);
}

/** Running processes first (most-recently-started first), then exited (most-recent first). */
export function sortProcessesForDisplay(
  processes: readonly ActivityProcessWire[],
): ActivityProcessWire[] {
  return [...processes].sort((a, b) => {
    const aRunning = isProcessRunning(a);
    const bRunning = isProcessRunning(b);
    if (aRunning !== bRunning) {
      return aRunning ? -1 : 1;
    }
    return (Date.parse(b.startedAt) || 0) - (Date.parse(a.startedAt) || 0);
  });
}
