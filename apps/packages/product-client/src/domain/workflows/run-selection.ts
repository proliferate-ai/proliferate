// Pure run-roster selection for the workflows gen-2 run view. Keep this file
// free of React and fetch; it may import only AnyHarness contract types and
// sibling pure domain modules.

import type { WorkflowRunV2 } from "@anyharness/sdk";
import { workflowRunIsActive } from "#product/domain/workflows/run-view-model";

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
