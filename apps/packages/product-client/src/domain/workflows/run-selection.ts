// Pure run-roster selection for the workflows gen-2 run view. Keep this file
// free of React and fetch; it may import only AnyHarness contract types.

import type { WorkflowRunV2 } from "@anyharness/sdk";

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
    if (
      !newest
      || candidate.createdAt > newest.createdAt
      || (candidate.createdAt === newest.createdAt && candidate.id > newest.id)
    ) {
      newest = candidate;
    }
  }
  return newest;
}
