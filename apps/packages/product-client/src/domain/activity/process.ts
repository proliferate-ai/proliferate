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

/**
 * Trailing status text for a background command's transcript row (bgwork
 * r8) — "running · 4m 12s" / "exited 0 · 2m 45s" (Design Handoff — "Chat -
 * Background Work Indicator", the "Running command" row's trailing muted
 * slot). Deliberately distinct from `processStatusLabel` (capitalized,
 * roster-row phrasing) and `processElapsedLabel` (coarse `relativeTimeLabel`
 * buckets like "4m", built for the roster list): this slot wants the exact
 * minutes+seconds shape the design mock shows.
 */
export function processTrailingStatusLabel(
  process: Pick<ActivityProcessWire, "status" | "startedAt" | "endedAt">,
  nowMs: number,
): string {
  const statusPart = process.status.status === "running"
    ? "running"
    : process.status.exitCode === null
      ? "exited"
      : `exited ${process.status.exitCode}`;
  return `${statusPart} · ${processFineDurationLabel(process, nowMs)}`;
}

function processFineDurationLabel(
  process: Pick<ActivityProcessWire, "status" | "startedAt" | "endedAt">,
  nowMs: number,
): string {
  const startedAtMs = Date.parse(process.startedAt) || 0;
  const endMs = process.status.status === "running"
    ? nowMs
    : (process.endedAt ? Date.parse(process.endedAt) || nowMs : nowMs);
  const totalSeconds = Math.max(0, Math.round((endMs - startedAtMs) / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
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
