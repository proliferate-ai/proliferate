import type { WorkflowRunTone } from "#product/domain/workflows/run-presentation";
import type { StatusDotTone } from "#product/primitives/StatusDot";

/**
 * Maps a run/definition status tone onto `StatusDot`'s tone axis. The single
 * owner of that mapping — `WorkflowRunDetail` and `WorkflowRunList` both used
 * to hand-roll their own `tone -> text-*` map with the same five branches.
 *
 * Lives here, not on `domain/workflows/run-presentation.ts`: ProductClient
 * domain modules may only import Cloud SDK types, AnyHarness contract
 * types/pure helpers, and test-only vitest (`check_frontend_boundaries.py`)
 * — a `StatusDot` import is a UI dependency and belongs in the component
 * layer that already owns `StatusDot` itself. `SubagentRosterRow.tsx` and
 * `TerminalRosterRow.tsx` keep the identical local-map pattern for their own
 * tone axes.
 */
const WORKFLOW_RUN_STATUS_DOT_TONE: Record<WorkflowRunTone, StatusDotTone> = {
  neutral: "muted",
  info: "info",
  success: "success",
  warning: "warning",
  danger: "danger",
};

export function workflowRunStatusDotTone(tone: WorkflowRunTone): StatusDotTone {
  return WORKFLOW_RUN_STATUS_DOT_TONE[tone];
}
