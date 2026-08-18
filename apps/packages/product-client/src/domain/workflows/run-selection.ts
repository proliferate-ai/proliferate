// Pure run-roster selection for the workflows gen-2 run view. Keep this file
// free of React and fetch; it may import only AnyHarness contract types and
// sibling pure domain modules.

import type { WorkflowRunV2 } from "@anyharness/sdk";
import { workflowRunIsActive } from "./run-view-model";

/**
 * Total order over a run set: newest `createdAt` first, an exact tie broken
 * by the row id so two runs minted in the same millisecond resolve to one
 * deterministic order rather than flickering between polls. Shared by
 * `selectNewestWorkflowRun` and `selectVisibleWorkflowRuns` so "newest" means
 * the same thing everywhere a run set is ranked.
 */
function compareWorkflowRunsNewestFirst(a: WorkflowRunV2, b: WorkflowRunV2): number {
  if (a.createdAt !== b.createdAt) {
    return a.createdAt > b.createdAt ? -1 : 1;
  }
  if (a.id !== b.id) {
    return a.id > b.id ? -1 : 1;
  }
  return 0;
}

/**
 * The workspace's run for the run view: the newest one it has. Runs are keyed
 * by `createdAt`, and an exact tie falls back to the row id so two runs minted
 * in the same millisecond still resolve to one deterministic winner rather
 * than flickering between polls.
 *
 * Lives at the domain layer because two surfaces have to agree on which run is
 * "the workspace's run": the pane facade, and the panel-independent
 * auto-advance watcher that raises the undo toast whether or not the pane is
 * mounted.
 */
export function selectNewestWorkflowRun(
  runs: readonly WorkflowRunV2[] | undefined,
): WorkflowRunV2 | null {
  let newest: WorkflowRunV2 | null = null;
  for (const candidate of runs ?? []) {
    if (!newest || compareWorkflowRunsNewestFirst(candidate, newest) < 0) {
      newest = candidate;
    }
  }
  return newest;
}

/**
 * The ordered set of runs the concurrent-run rail shows: every non-terminal
 * run, newest first, since the rail exists to disambiguate live work in
 * progress. When there is no non-terminal run, the set collapses to the
 * single newest run (or nothing) — the same run `selectNewestWorkflowRun`
 * would have picked — so history that has already finished renders exactly
 * as it does today instead of growing a second rail out of the past.
 *
 * Workflow placement is normally exclusive (starting a run occupies the
 * workspace, so at most one run is non-terminal at a time), except under
 * `existing_workspace` placement, where a workspace can be adopted by more
 * than one run and several can be live together. `selectVisibleWorkflowRuns`
 * is what lets that case render as one rail per run instead of only ever
 * showing one of them; every other placement keeps producing at most one
 * element here, which is why the ≤1-visible-run case is required to render
 * identically to `selectNewestWorkflowRun` today.
 */
export function selectVisibleWorkflowRuns(
  runs: readonly WorkflowRunV2[] | undefined,
): readonly WorkflowRunV2[] {
  const active = (runs ?? []).filter(workflowRunIsActive);
  if (active.length > 0) {
    return active.sort(compareWorkflowRunsNewestFirst);
  }
  const newest = selectNewestWorkflowRun(runs);
  return newest ? [newest] : [];
}

/** How many run rails the pane renders at once (ruling F-A2). */
export const MAX_VISIBLE_RUN_RAILS = 4;

/**
 * A run the cap must never hide silently (ruling F-A2): it is waiting on a
 * human (a gate or an approval), parked, or failed. These are promoted ahead
 * of merely-running work when the rail window is chosen, so hitting a gate
 * SURFACES a run rather than leaving it behind the overflow line.
 */
export function workflowRunNeedsAttention(run: WorkflowRunV2): boolean {
  return (
    run.status === "awaiting_human" ||
    run.status === "interrupted" ||
    run.status === "failed"
  );
}

/**
 * The fixed-size window of runs the pane actually renders as rails, cut from
 * the visible set (ruling F-A2: cap at four, no census exception, no
 * virtualization). Priority inside the window: runs needing attention first,
 * then the rest, each group newest-first — so page 0, the page the pane rests
 * on, always carries every run a human is being waited on (up to the cap).
 * The overflow line pages this window; `page` is clamped so a shrinking run
 * set can never strand the pane on an empty page.
 */
export interface WorkflowRunRailWindow {
  /** The ≤4 runs rendered as rails, in render order. */
  railWindow: readonly WorkflowRunV2[];
  /** Visible runs not in the window (behind the overflow line). */
  hiddenCount: number;
  /** Total pages the window can show; ≥1 whenever any run is visible. */
  pageCount: number;
  /** The clamped page this window was cut for. */
  page: number;
}

export function selectWorkflowRunRailWindow(
  visibleRuns: readonly WorkflowRunV2[],
  requestedPage: number,
): WorkflowRunRailWindow {
  const attention = visibleRuns.filter(workflowRunNeedsAttention);
  const rest = visibleRuns.filter((run) => !workflowRunNeedsAttention(run));
  const prioritized = [...attention, ...rest];
  const pageCount = Math.max(1, Math.ceil(prioritized.length / MAX_VISIBLE_RUN_RAILS));
  const page = Math.min(Math.max(requestedPage, 0), pageCount - 1);
  const start = page * MAX_VISIBLE_RUN_RAILS;
  const railWindow = prioritized.slice(start, start + MAX_VISIBLE_RUN_RAILS);
  return {
    railWindow,
    hiddenCount: prioritized.length - railWindow.length,
    pageCount,
    page,
  };
}
