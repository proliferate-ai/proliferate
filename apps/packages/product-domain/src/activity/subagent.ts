/**
 * Activity subagent — pure mirror of `anyharness-contract v1::ActivitySubagent`.
 * A harness-native subagent (Claude Task agent, Codex collab child thread,
 * Cursor `cursor/task`). Read-only roster element; per
 * `codex/session-activity-architecture.md` the ⑂ chip routes to the existing
 * delegated-work surfaces — harness-native subagents become a new
 * delegated-work *source* feeding `kind: "subagent"` items, so this module
 * also owns the pure status/field mapping into that shape (identity
 * synthesis — generated name/color — stays desktop-owned, same as the
 * existing delegated-work source).
 */

import { relativeTimeLabel } from "../workspaces/cloud-work-time";

export type SubagentStatus =
  | { status: "running" }
  | { status: "completed"; summary: string | null }
  | { status: "failed" };

export type FeedKind = "terminal_bytes" | "transcript";

export interface FeedRefWire {
  feedId: string;
  kind: FeedKind;
}

export interface ActivityUsageWire {
  tokensUsed: number | null;
  toolCalls: number | null;
  durationSeconds: number | null;
}

export interface ActivitySubagentWire {
  /** Claude `task_id` / Codex child `threadId` / Cursor `agentId`. */
  id: string;
  agentType: string | null;
  description: string | null;
  model: string | null;
  background: boolean;
  status: SubagentStatus;
  usage: ActivityUsageWire | null;
  feed: FeedRefWire | null;
}

/**
 * Strict parse of a wire payload into an `ActivitySubagentWire`. Returns null
 * on any shape violation.
 */
export function parseActivitySubagentWire(value: unknown): ActivitySubagentWire | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.background !== "boolean") {
    return null;
  }
  const status = parseSubagentStatus(record.status);
  if (!status) {
    return null;
  }
  const agentType = nullableString(record.agentType);
  const description = nullableString(record.description);
  const model = nullableString(record.model);
  if (agentType === undefined || description === undefined || model === undefined) {
    return null;
  }
  return {
    id: record.id,
    agentType,
    description,
    model,
    background: record.background,
    status,
    usage: parseActivityUsageWire(record.usage) ?? null,
    feed: parseFeedRefWire(record.feed) ?? null,
  };
}

function parseSubagentStatus(value: unknown): SubagentStatus | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.status === "running") {
    return { status: "running" };
  }
  if (record.status === "failed") {
    return { status: "failed" };
  }
  if (record.status === "completed") {
    const summary = nullableString(record.summary);
    return { status: "completed", summary: summary ?? null };
  }
  return null;
}

function parseActivityUsageWire(value: unknown): ActivityUsageWire | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const tokensUsed = nullableNumber(record.tokensUsed);
  const toolCalls = nullableNumber(record.toolCalls);
  const durationSeconds = nullableNumber(record.durationSeconds);
  if (tokensUsed === undefined || toolCalls === undefined || durationSeconds === undefined) {
    return null;
  }
  return { tokensUsed, toolCalls, durationSeconds };
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

export type SubagentTone = "default" | "positive" | "danger";

export function subagentStatusLabel(subagent: Pick<ActivitySubagentWire, "status">): string {
  switch (subagent.status.status) {
    case "running":
      return "Running";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
  }
}

export function subagentStatusTone(subagent: Pick<ActivitySubagentWire, "status">): SubagentTone {
  switch (subagent.status.status) {
    case "running":
      return "default";
    case "completed":
      return "positive";
    case "failed":
      return "danger";
  }
}

export function subagentDisplayTitle(subagent: ActivitySubagentWire): string {
  return subagent.description ?? subagent.agentType ?? "Subagent";
}

/** Running first (most recent activity implied by wire order), then completed/failed. */
export function sortSubagentsForDisplay(
  subagents: readonly ActivitySubagentWire[],
): ActivitySubagentWire[] {
  return [...subagents].sort((a, b) => {
    const aRunning = a.status.status === "running";
    const bRunning = b.status.status === "running";
    if (aRunning !== bRunning) {
      return aRunning ? -1 : 1;
    }
    return 0;
  });
}

export function subagentUsageDurationLabel(usage: ActivityUsageWire | null, nowMs: number): string | null {
  if (!usage?.durationSeconds) {
    return null;
  }
  return relativeTimeLabel(nowMs - usage.durationSeconds * 1000, nowMs);
}

// ---------------------------------------------------------------------------
// Delegated-work roster mapping. Mirrors the value vocabulary of desktop's
// `DelegatedWorkStatusCategory` (apps/desktop/src/lib/domain/delegated-work/
// model.ts) by string literal — product-domain does not depend on desktop, so
// this is a parallel, intentionally identical union rather than a shared
// import. Per the locked architecture only Running/Completed/Failed map here;
// loops are a separate primitive and never become delegated work.
// ---------------------------------------------------------------------------

export type ActivitySubagentDelegatedWorkStatusCategory = "running" | "finished" | "failed";

export function subagentStatusToDelegatedWorkStatusCategory(
  status: SubagentStatus,
): ActivitySubagentDelegatedWorkStatusCategory {
  switch (status.status) {
    case "running":
      return "running";
    case "completed":
      return "finished";
    case "failed":
      return "failed";
  }
}

/**
 * The subset of `DelegatedWorkItem` fields (delegated-work.md's product
 * model) this roster can supply directly from the wire mirror. Identity
 * synthesis (generatedName/shortId/colorToken/displayName) and the actual
 * open-target/session link are desktop-owned, same as the existing
 * tool-created subagent source — this is the pure data half of the mapping.
 */
export interface ActivitySubagentDelegatedWorkFields {
  kind: "subagent";
  source: "activity_roster";
  title: string;
  statusCategory: ActivitySubagentDelegatedWorkStatusCategory;
  background: boolean;
  model: string | null;
  latestResult: string | null;
}

export function activitySubagentToDelegatedWorkFields(
  subagent: ActivitySubagentWire,
): ActivitySubagentDelegatedWorkFields {
  return {
    kind: "subagent",
    source: "activity_roster",
    title: subagentDisplayTitle(subagent),
    statusCategory: subagentStatusToDelegatedWorkStatusCategory(subagent.status),
    background: subagent.background,
    model: subagent.model,
    latestResult: subagent.status.status === "completed" ? subagent.status.summary : null,
  };
}
