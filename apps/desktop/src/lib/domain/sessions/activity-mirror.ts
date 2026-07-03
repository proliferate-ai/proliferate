import type {
  ActivityProcess,
  ActivitySubagent,
  ActivityUsage,
  FeedRef,
  Loop,
  ProcessStatus,
  SessionActionCapabilities,
  SessionActivity,
  SubagentStatus,
} from "@anyharness/sdk";
import type { LoopCapabilities, LoopWire } from "@proliferate/product-domain/activity/loop";
import type {
  ActivityProcessWire,
  FeedRefWire,
  ProcessStatus as ProcessStatusWire,
} from "@proliferate/product-domain/activity/process";
import type {
  ActivitySubagentWire,
  ActivityUsageWire,
  SubagentStatus as SubagentStatusWire,
} from "@proliferate/product-domain/activity/subagent";

/**
 * Per-session loop capability, projected from the runtime's action
 * capabilities (`InitializeResponse._meta.anyharness.loops` → the mirrored
 * `SessionActionCapabilities`). Claude is native; Codex is runtime-emulated
 * (`supportsLoops` true, `loopsNative` false); harnesses without loops report
 * unsupported. The UI gates on these flags only, never on a harness name.
 */
export function loopCapabilitiesForSession(
  actionCapabilities: SessionActionCapabilities,
): LoopCapabilities {
  const supported = actionCapabilities.supportsLoops ?? false;
  return {
    supported,
    native: supported && (actionCapabilities.loopsNative ?? false),
  };
}

/**
 * Projects a mirrored `Loop` record into the wire-contract shape the loops
 * panel renders. Pure field mapping — absent optionals read as null exactly
 * like the sidecar wire payloads; no state is invented.
 */
export function loopWireFromMirror(loop: Loop): LoopWire {
  return {
    loopId: loop.loopId,
    prompt: loop.prompt,
    schedule: { kind: loop.schedule.kind, expr: loop.schedule.expr },
    recurring: loop.recurring,
    status: loop.status,
    native: loop.native,
    lastFiredAtMs: loop.lastFiredAtMs ?? null,
    fireCount: loop.fireCount,
    updatedAtMs: loop.updatedAtMs,
  };
}

function feedRefWireFromMirror(feed: FeedRef | null | undefined): FeedRefWire | null {
  if (!feed) {
    return null;
  }
  return { feedId: feed.feedId, kind: feed.kind };
}

function processStatusWireFromMirror(status: ProcessStatus): ProcessStatusWire {
  if (status.status === "exited") {
    return { status: "exited", exitCode: status.exitCode ?? null };
  }
  return { status: "running" };
}

export function activityProcessWireFromMirror(process: ActivityProcess): ActivityProcessWire {
  return {
    id: process.id,
    command: process.command,
    cwd: process.cwd ?? null,
    status: processStatusWireFromMirror(process.status),
    pid: process.pid ?? null,
    startedAt: process.startedAt,
    endedAt: process.endedAt ?? null,
    feed: feedRefWireFromMirror(process.feed),
  };
}

function subagentStatusWireFromMirror(status: SubagentStatus): SubagentStatusWire {
  if (status.status === "completed") {
    return { status: "completed", summary: status.summary ?? null };
  }
  if (status.status === "failed") {
    return { status: "failed" };
  }
  return { status: "running" };
}

function activityUsageWireFromMirror(usage: ActivityUsage | null | undefined): ActivityUsageWire | null {
  if (!usage) {
    return null;
  }
  return {
    tokensUsed: usage.tokensUsed ?? null,
    toolCalls: usage.toolCalls ?? null,
    durationSeconds: usage.durationSeconds ?? null,
  };
}

export function activitySubagentWireFromMirror(agent: ActivitySubagent): ActivitySubagentWire {
  return {
    id: agent.id,
    agentType: agent.agentType ?? null,
    description: agent.description ?? null,
    model: agent.model ?? null,
    background: agent.background,
    status: subagentStatusWireFromMirror(agent.status),
    usage: activityUsageWireFromMirror(agent.usage),
    feed: feedRefWireFromMirror(agent.feed),
  };
}

export interface ProjectedSessionActivity {
  loops: LoopWire[];
  processes: ActivityProcessWire[];
  agents: ActivitySubagentWire[];
}

/**
 * Projects the runtime's mirrored `SessionActivity` aggregate into the wire
 * shapes the activity bar / panels render. Roster collections are optional on
 * the wire (omitted when empty), so absent reads as `[]`.
 */
export function projectSessionActivity(
  activity: SessionActivity | null | undefined,
): ProjectedSessionActivity {
  if (!activity) {
    return { loops: [], processes: [], agents: [] };
  }
  return {
    loops: (activity.loops ?? []).map(loopWireFromMirror),
    processes: (activity.processes ?? []).map(activityProcessWireFromMirror),
    agents: (activity.agents ?? []).map(activitySubagentWireFromMirror),
  };
}
