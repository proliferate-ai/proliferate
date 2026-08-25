/**
 * Shared status-tone vocabulary for workflow run views. The gen-1 managed-run
 * presentation matrix that used to live here died with the gen-1 lane;
 * `run-view-model.ts` owns the gen-2 node/run presentation and speaks this
 * tone vocabulary so `workflow-run-status-dot.tsx` can render either.
 */

export type WorkflowRunTone = "neutral" | "info" | "success" | "warning" | "danger";
