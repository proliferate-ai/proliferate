import type { GitStatusSnapshot } from "@anyharness/sdk";
import type { ActivitySubagentWire } from "@proliferate/product-domain/activity/subagent";
import {
  sortSubagentsForDisplay,
  subagentDisplayTitle,
  subagentUsageDurationLabel,
} from "@proliferate/product-domain/activity/subagent";
import type { LoopWire } from "@proliferate/product-domain/activity/loop";
import {
  humanizeLoopCadence,
  loopNextFireAtMs,
  relativeFutureTimeLabel,
  sortLoopsForDisplay,
} from "@proliferate/product-domain/activity/loop";
import type { ActivityProcessWire } from "@proliferate/product-domain/activity/process";
import {
  isProcessRunning,
  processElapsedLabel,
  processStatusLabel,
  sortProcessesForDisplay,
} from "@proliferate/product-domain/activity/process";
import type { WorkspaceActivityPullRequest } from "@/lib/domain/workspaces/activity/composer-workspace-activity";
import type {
  WorkspaceStatusDetailItem,
  WorkspaceStatusModel,
  WorkspaceStatusNativeRow,
  WorkspaceStatusSubagentRow,
} from "@/components/workspace/chat/input/workspace-status/WorkspaceStatusComposerControl";

/** One of our agents (delegated subagent or review agent) as the hook feeds
 * it — already carrying identity tint and the session to focus on click. */
export interface WorkspaceStatusAgentSource {
  key: string;
  name: string;
  sessionId: string | null;
  tintClassName?: string;
  working: boolean;
}

export interface WorkspaceStatusModelInput {
  gitStatus: GitStatusSnapshot | null;
  pullRequest: WorkspaceActivityPullRequest | null;
  hasExistingPullRequest: boolean;
  /** Provider base...branch compare page, when one exists to link. */
  compareUrl: string | null;
  agents: WorkspaceStatusAgentSource[];
  activity: {
    agents: ActivitySubagentWire[];
    loops: LoopWire[];
    processes: ActivityProcessWire[];
  };
  nowMs: number;
}

const LOOP_TITLE_MAX_CHARS = 44;

export function buildWorkspaceStatusModel(
  input: WorkspaceStatusModelInput,
): WorkspaceStatusModel | null {
  const environment = buildEnvironment(input);
  const subagents = buildSubagents(input.agents);
  const native = buildNative(input.activity, input.nowMs);

  if (!environment && subagents.working.length === 0 && subagents.done.length === 0
    && native.length === 0) {
    return null;
  }

  return { environment, subagents, native };
}

function buildEnvironment({
  gitStatus,
  pullRequest,
  hasExistingPullRequest,
  compareUrl,
}: WorkspaceStatusModelInput): WorkspaceStatusModel["environment"] {
  if (!gitStatus) {
    return null;
  }

  const changedFiles = gitStatus.summary.changedFiles;
  const syncParts = [
    gitStatus.ahead > 0 ? `${gitStatus.ahead} ahead` : null,
    gitStatus.behind > 0 ? `${gitStatus.behind} behind` : null,
  ].filter((part): part is string => part !== null);

  return {
    reviewChangesLabel: changedFiles === 0
      ? "No changes"
      : `Review ${changedFiles} ${changedFiles === 1 ? "change" : "changes"}`,
    commitOrPushLabel: "Commit or push",
    commitOrPushMeta: syncParts.join(" · ") || null,
    // Clean tree with nothing ahead: the row has no work to offer — dim it
    // in the card instead of letting the modal deliver the bad news.
    commitOrPushDisabled: changedFiles === 0 && gitStatus.ahead === 0,
    // With a PR the row becomes "View PR" (opens it); without one it opens
    // the provider's base...branch compare page.
    compareLabel: hasExistingPullRequest ? "View PR" : "Compare branch",
    compareMeta: hasExistingPullRequest && pullRequest?.number != null
      ? `#${pullRequest.number}`
      : null,
    compareOpensPr: hasExistingPullRequest,
    // No PR and no compare page (e.g. sitting on the base branch, or no
    // GitHub remote): the row has nowhere to go — dim it, never fall back
    // to the publish modal.
    compareDisabled: !hasExistingPullRequest && !compareUrl,
    checks: buildChecks(pullRequest),
  };
}

/** Aggregate-only until the runtime exposes per-check runs (contract change
 * tracked separately) — items stay empty so the hover card simply does not
 * render, and the action is "View" → open the PR. */
function buildChecks(
  pullRequest: WorkspaceActivityPullRequest | null,
): NonNullable<WorkspaceStatusModel["environment"]>["checks"] {
  if (!pullRequest || pullRequest.checks === "none") {
    return null;
  }
  const state = pullRequest.checks;
  const label = state === "failing"
    ? "Checks failing"
    : state === "pending"
      ? "Checks pending"
      : "Checks passing";
  return {
    label,
    state,
    actionLabel: "View",
    items: [],
  };
}

function buildSubagents(
  agents: WorkspaceStatusAgentSource[],
): WorkspaceStatusModel["subagents"] {
  const toRow = (agent: WorkspaceStatusAgentSource): WorkspaceStatusSubagentRow => ({
    key: agent.key,
    name: agent.name,
    sessionId: agent.sessionId,
    tintClassName: agent.tintClassName,
  });
  return {
    working: agents.filter((agent) => agent.working).map(toRow),
    done: agents.filter((agent) => !agent.working).map(toRow),
  };
}

function buildNative(
  activity: WorkspaceStatusModelInput["activity"],
  nowMs: number,
): WorkspaceStatusNativeRow[] {
  const rows: WorkspaceStatusNativeRow[] = [];

  if (activity.agents.length > 0) {
    const sorted = sortSubagentsForDisplay(activity.agents);
    const runningCount = sorted.filter((agent) => agent.status.status === "running").length;
    rows.push({
      key: "native-agents",
      kind: "agents",
      label: `${sorted.length} ${sorted.length === 1 ? "subagent" : "subagents"}`,
      meta: runningCount > 0 ? `${runningCount} running` : undefined,
      items: sorted.map((agent): WorkspaceStatusDetailItem => ({
        key: agent.id,
        name: subagentDisplayTitle(agent),
        state: agent.status.status === "running"
          ? "working"
          : agent.status.status === "failed"
            ? "failing"
            : "done",
        meta: subagentUsageDurationLabel(agent.usage, nowMs) ?? undefined,
      })),
    });
  }

  if (activity.processes.length > 0) {
    const sorted = sortProcessesForDisplay(activity.processes);
    const runningCount = sorted.filter((process) => isProcessRunning(process)).length;
    rows.push({
      key: "native-terminals",
      kind: "terminals",
      label: `${sorted.length} ${sorted.length === 1 ? "terminal" : "terminals"}`,
      meta: runningCount > 0 ? `${runningCount} running` : undefined,
      items: sorted.map((process): WorkspaceStatusDetailItem => ({
        key: process.id,
        name: process.command,
        state: process.status.status === "running"
          ? "working"
          : (process.status.exitCode ?? 0) !== 0
            ? "failing"
            : "done",
        detail: isProcessRunning(process) ? undefined : processStatusLabel(process),
        meta: processElapsedLabel(process, nowMs),
      })),
    });
  }

  const activeLoops = activity.loops.filter((loop) => loop.status === "active");
  if (activeLoops.length > 0) {
    const sorted = sortLoopsForDisplay(activeLoops);
    const nextFires = sorted
      .map((loop) => loopNextFireAtMs(loop, nowMs))
      .filter((value): value is number => value !== null);
    const soonest = nextFires.length > 0 ? Math.min(...nextFires) : null;
    rows.push({
      key: "native-loops",
      kind: "loops",
      label: `${sorted.length} ${sorted.length === 1 ? "loop" : "loops"}`,
      meta: soonest !== null ? `next ${relativeFutureTimeLabel(soonest, nowMs)}` : undefined,
      items: sorted.map((loop): WorkspaceStatusDetailItem => {
        const nextFire = loopNextFireAtMs(loop, nowMs);
        return {
          key: loop.loopId,
          name: loopTitle(loop),
          state: "pending",
          detail: humanizeLoopCadence(loop.schedule),
          meta: nextFire !== null ? relativeFutureTimeLabel(nextFire, nowMs) : undefined,
        };
      }),
    });
  }

  return rows;
}

/** LoopWire only carries the full prompt text — derive a short row title
 * from its first line. */
function loopTitle(loop: LoopWire): string {
  const firstLine = loop.prompt.split("\n", 1)[0]?.trim() ?? "";
  if (firstLine.length === 0) {
    return "Loop";
  }
  if (firstLine.length <= LOOP_TITLE_MAX_CHARS) {
    return firstLine;
  }
  return `${firstLine.slice(0, LOOP_TITLE_MAX_CHARS - 1).trimEnd()}…`;
}
